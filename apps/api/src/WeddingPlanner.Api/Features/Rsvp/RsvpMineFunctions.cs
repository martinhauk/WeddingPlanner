using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;

using WeddingPlanner.Api.Http;
using WeddingPlanner.Api.Pipeline;
using WeddingPlanner.Api.Storage;
using WeddingPlanner.Api.Storage.Rsvps;
using WeddingPlanner.Domain.Rsvp;

namespace WeddingPlanner.Api.Features.Rsvp;

/// <summary>
/// <c>GET</c>, <c>PUT</c> and <c>DELETE /api/rsvp/me</c>: the caller's own reply, identified by the <c>wp_rsvp</c>
/// cookie. Without a valid cookie every method answers 404 <c>not_found</c> and clears stale RSVP cookies.
/// </summary>
/// <remarks>
/// <list type="bullet">
///   <item><c>GET</c>: 200 <c>{rsvp, version, open, deadline}</c> with <c>ETag</c> (the same value as
///   <c>version</c>); works after the deadline (read-only), and refreshes the cookies' lifetime.</item>
///   <item><c>PUT</c>: replaces the reply while open. Requires <c>If-Match</c> with the ETag or <c>version</c> from
///   the last read (428 <c>precondition_required</c> without it, 412 <c>precondition_failed</c> when the reply
///   changed since). Person ids sent back are kept. 200 <c>{rsvp, version, open, deadline}</c> with the new
///   <c>ETag</c>.</item>
///   <item><c>DELETE</c>: deletes the reply while open (<c>If-Match</c> optional) and clears the cookies; 204.</item>
/// </list>
/// After the deadline <c>PUT</c> and <c>DELETE</c> answer 403 <c>rsvp_closed</c>.
/// </remarks>
public sealed class RsvpMineFunctions(IRsvpRepository repository, RsvpSettings settings, TimeProvider timeProvider)
{
    /// <summary>Function name of <c>GET /api/rsvp/me</c>.</summary>
    public const string GetFunctionName = "RsvpGetMine";

    /// <summary>Function name of <c>PUT /api/rsvp/me</c>.</summary>
    public const string UpdateFunctionName = "RsvpUpdateMine";

    /// <summary>Function name of <c>DELETE /api/rsvp/me</c>.</summary>
    public const string DeleteFunctionName = "RsvpDeleteMine";

    private const string Route = "rsvp/me";

    [Function(GetFunctionName)]
    public async Task<IActionResult> Get(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = Route)] HttpRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var response = request.HttpContext.Response;
        RsvpHttp.NoStore(response);

        if (!repository.IsConfigured)
        {
            return RsvpHttp.NotConfigured();
        }

        if (await RsvpHttp.AuthenticateAsync(repository, request, cancellationToken) is not { } session)
        {
            return RsvpHttp.NotFound(request);
        }

        return Mine(response, session.Credential, session.Stored);
    }

    [Function(UpdateFunctionName)]
    public async Task<IActionResult> Update(
        [HttpTrigger(AuthorizationLevel.Anonymous, "put", Route = Route)] HttpRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var response = request.HttpContext.Response;
        RsvpHttp.NoStore(response);

        if (!repository.IsConfigured || settings.Deadline is not { } deadline)
        {
            return RsvpHttp.NotConfigured();
        }

        var now = timeProvider.GetUtcNow();
        if (!deadline.IsOpenAt(now))
        {
            return RsvpHttp.Closed();
        }

        if (RsvpHttp.ReadIfMatch(request) is not { } ifMatch)
        {
            return ApiProblem.Create(StatusCodes.Status428PreconditionRequired, ProblemCodes.PreconditionRequired);
        }

        var body = await JsonBody.ReadAsync<RsvpRequest>(request, RequestOriginGuardMiddleware.RsvpMaxBodyBytes, cancellationToken);
        if (!body.TryGetValue(out var input, out var bodyProblem))
        {
            return bodyProblem;
        }

        var validation = RsvpValidator.Validate(input.ToDraft(), settings.Limits);
        if (validation.Answer is not { } answer)
        {
            return RsvpHttp.ValidationFailed(validation.Errors);
        }

        if (RsvpDietaryConsent.Check(answer, input.DietaryConsent) is { } consentError)
        {
            return RsvpHttp.ValidationFailed([consentError]);
        }

        if (await RsvpHttp.AuthenticateAsync(repository, request, cancellationToken) is not { } session)
        {
            return RsvpHttp.NotFound(request);
        }

        if (!RsvpHttp.IfMatchMatches(ifMatch, session.Stored.ETag))
        {
            return RsvpHttp.PreconditionFailed();
        }

        var current = session.Stored.Record;
        var existingIds = current.Answer.People.Select(person => person.Id).OfType<string>();
        var record = current with
        {
            Answer = PersonIds.Assign(answer, existingIds),
            UpdatedAt = now,
            DietaryConsent = RsvpDietaryConsent.HasDietaryData(answer),
        };

        StoredRsvp? replaced;
        try
        {
            replaced = await repository.ReplaceAsync(record, session.Stored.ETag, cancellationToken);
        }
        catch (ConcurrencyConflictException)
        {
            return RsvpHttp.PreconditionFailed();
        }

        return replaced is null ? RsvpHttp.NotFound(request) : Mine(response, session.Credential, replaced);
    }

    [Function(DeleteFunctionName)]
    public async Task<IActionResult> Delete(
        [HttpTrigger(AuthorizationLevel.Anonymous, "delete", Route = Route)] HttpRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var response = request.HttpContext.Response;
        RsvpHttp.NoStore(response);

        if (!repository.IsConfigured || settings.Deadline is not { } deadline)
        {
            return RsvpHttp.NotConfigured();
        }

        if (!deadline.IsOpenAt(timeProvider.GetUtcNow()))
        {
            return RsvpHttp.Closed();
        }

        if (await RsvpHttp.AuthenticateAsync(repository, request, cancellationToken) is not { } session)
        {
            return RsvpHttp.NotFound(request);
        }

        if (RsvpHttp.ReadIfMatch(request) is { } ifMatch && !RsvpHttp.IfMatchMatches(ifMatch, session.Stored.ETag))
        {
            return RsvpHttp.PreconditionFailed();
        }

        try
        {
            await repository.DeleteAsync(session.Stored.Record.Id, session.Stored.ETag, cancellationToken);
        }
        catch (ConcurrencyConflictException)
        {
            return RsvpHttp.PreconditionFailed();
        }

        RsvpCookies.Clear(response);
        return ApiResult.Empty(StatusCodes.Status204NoContent);
    }

    private ApiResult Mine(HttpResponse response, RsvpCredential credential, StoredRsvp stored)
    {
        RsvpCookies.Set(response, credential, stored.Record.Answer.Attending, settings.CookieLifetime);
        var version = RsvpHttp.PublicETag(stored.ETag);
        response.Headers.ETag = version;

        var deadline = settings.Deadline;
        var open = deadline?.IsOpenAt(timeProvider.GetUtcNow()) ?? false;
        return ApiResult.Json(StatusCodes.Status200OK, new RsvpMineResponse(RsvpView.From(stored.Record), version, open, deadline?.Utc.UtcDateTime));
    }
}
