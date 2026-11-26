using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;

using WeddingPlanner.Api.Features.Rsvp;
using WeddingPlanner.Api.Http;
using WeddingPlanner.Api.Pipeline;
using WeddingPlanner.Api.Storage;
using WeddingPlanner.Api.Storage.Rsvps;
using WeddingPlanner.Domain.Rsvp;

namespace WeddingPlanner.Api.Features.Admin.Rsvps;

/// <summary>
/// Reply management for admins: <c>GET /api/admin/rsvps</c> (every reply and the totals), <c>PUT</c> and
/// <c>DELETE /api/admin/rsvps/{id}</c>. Gated by <c>Features__Admin</c> and the admin authorization middleware
/// (role <c>admin</c>, provider <c>aad</c>). Admins may change replies after the RSVP deadline. Responses are
/// <c>no-store</c>; nothing about a reply is logged.
/// </summary>
/// <remarks>
/// <list type="bullet">
///   <item><c>GET</c>: 200 <c>{rsvps: [{id, attending, people, message, language, createdAt, updatedAt, version}],
///   totals}</c>, latest change first.</item>
///   <item><c>PUT</c>: replaces the reply with the body (the same shape as the guest's <c>PUT /api/rsvp/me</c>; the
///   honeypot is ignored). Requires <c>If-Match</c> with the reply's <c>version</c> (428 without, 412 when it changed
///   since). Person ids sent back are kept. 200 <c>{rsvp}</c> with the new <c>version</c>.</item>
///   <item><c>DELETE</c>: deletes the reply (<c>If-Match</c> optional, 412 when it does not match); 204.</item>
/// </list>
/// An unknown id answers 404 <c>not_found</c>.
/// </remarks>
public sealed class AdminRsvpsFunctions(IRsvpRepository repository, RsvpSettings settings, TimeProvider timeProvider)
{
    /// <summary>Function name of <c>GET /api/admin/rsvps</c>.</summary>
    public const string ListFunctionName = "AdminRsvpsList";

    /// <summary>Function name of <c>PUT /api/admin/rsvps/{id}</c>.</summary>
    public const string UpdateFunctionName = "AdminRsvpsUpdate";

    /// <summary>Function name of <c>DELETE /api/admin/rsvps/{id}</c>.</summary>
    public const string DeleteFunctionName = "AdminRsvpsDelete";

    [Function(ListFunctionName)]
    public async Task<IActionResult> List(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = AdminRoutes.Rsvps)] HttpRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        RsvpHttp.NoStore(request.HttpContext.Response);

        if (!repository.IsConfigured)
        {
            return RsvpHttp.NotConfigured();
        }

        var stored = await repository.ListAsync(cancellationToken);
        var rsvps = stored
            .OrderByDescending(item => item.Record.UpdatedAt)
            .ThenBy(item => item.Record.Id, StringComparer.Ordinal)
            .Select(AdminRsvpView.From)
            .ToList();

        return ApiResult.Json(StatusCodes.Status200OK, new AdminRsvpListResponse(rsvps, AdminRsvpTotals.From(stored.Select(item => item.Record))));
    }

    [Function(UpdateFunctionName)]
    public async Task<IActionResult> Update(
        [HttpTrigger(AuthorizationLevel.Anonymous, "put", Route = AdminRoutes.Rsvp)] HttpRequest request,
        string id,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        RsvpHttp.NoStore(request.HttpContext.Response);

        if (!repository.IsConfigured)
        {
            return RsvpHttp.NotConfigured();
        }

        if (!IsValidId(id))
        {
            return NotFound();
        }

        if (RsvpHttp.ReadIfMatch(request) is not { } ifMatch)
        {
            return ApiProblem.Create(StatusCodes.Status428PreconditionRequired, ProblemCodes.PreconditionRequired);
        }

        var body = await JsonBody.ReadAsync<RsvpRequest>(request, RequestOriginGuardMiddleware.AdminMaxBodyBytes, cancellationToken);
        if (!body.TryGetValue(out var input, out var bodyProblem))
        {
            return bodyProblem;
        }

        // The honeypot only matters for anonymous guests.
        var validation = RsvpValidator.Validate(input.ToDraft() with { Website = null }, settings.Limits);
        if (validation.Answer is not { } answer)
        {
            return RsvpHttp.ValidationFailed(validation.Errors);
        }

        if (await repository.GetAsync(id, cancellationToken) is not { } stored)
        {
            return NotFound();
        }

        if (!RsvpHttp.IfMatchMatches(ifMatch, stored.ETag))
        {
            return RsvpHttp.PreconditionFailed();
        }

        var current = stored.Record;
        var existingIds = current.Answer.People.Select(person => person.Id).OfType<string>();
        var record = current with { Answer = PersonIds.Assign(answer, existingIds), UpdatedAt = timeProvider.GetUtcNow() };

        StoredRsvp? replaced;
        try
        {
            replaced = await repository.ReplaceAsync(record, stored.ETag, cancellationToken);
        }
        catch (ConcurrencyConflictException)
        {
            return RsvpHttp.PreconditionFailed();
        }

        return replaced is null
            ? NotFound()
            : ApiResult.Json(StatusCodes.Status200OK, new AdminRsvpUpdatedResponse(AdminRsvpView.From(replaced)));
    }

    [Function(DeleteFunctionName)]
    public async Task<IActionResult> Delete(
        [HttpTrigger(AuthorizationLevel.Anonymous, "delete", Route = AdminRoutes.Rsvp)] HttpRequest request,
        string id,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        RsvpHttp.NoStore(request.HttpContext.Response);

        if (!repository.IsConfigured)
        {
            return RsvpHttp.NotConfigured();
        }

        if (!IsValidId(id) || await repository.GetAsync(id, cancellationToken) is not { } stored)
        {
            return NotFound();
        }

        if (RsvpHttp.ReadIfMatch(request) is { } ifMatch && !RsvpHttp.IfMatchMatches(ifMatch, stored.ETag))
        {
            return RsvpHttp.PreconditionFailed();
        }

        try
        {
            if (!await repository.DeleteAsync(id, stored.ETag, cancellationToken))
            {
                return NotFound();
            }
        }
        catch (ConcurrencyConflictException)
        {
            return RsvpHttp.PreconditionFailed();
        }

        return ApiResult.Empty(StatusCodes.Status204NoContent);
    }

    /// <summary>
    /// Whether <paramref name="id"/> can be a reply id: 1 to 64 ASCII letters or digits, the only row keys the
    /// repository accepts. Anything else is answered with 404 before storage is touched.
    /// </summary>
    internal static bool IsValidId(string? id) => id is { Length: > 0 and <= 64 } && id.All(char.IsAsciiLetterOrDigit);

    private static ApiResult NotFound() => ApiProblem.Create(StatusCodes.Status404NotFound, ProblemCodes.NotFound);
}
