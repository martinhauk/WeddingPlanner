using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.Logging;

using WeddingPlanner.Api.Http;
using WeddingPlanner.Api.Pipeline;
using WeddingPlanner.Api.Storage.Rsvps;
using WeddingPlanner.Domain.Rsvp;

namespace WeddingPlanner.Api.Features.Rsvp;

/// <summary>
/// <c>POST /api/rsvp</c>: creates the caller's reply and sets the RSVP cookies. Answers 201 <c>{rsvp}</c> with
/// <c>ETag</c> and <c>Location: /api/rsvp/me</c>.
/// </summary>
/// <remarks>
/// Order of checks (cheap ones first, I/O last): 503 <c>not_configured</c>, 403 <c>rsvp_closed</c>, body
/// (415/413/400 <c>invalid_json</c>), 400 <c>validation_failed</c> (honeypot included), 409 <c>rsvp_exists</c> when
/// the request already carries a valid <c>wp_rsvp</c> cookie, 503 <c>capacity_reached</c> at the cap. The cap is
/// checked by counting before the insert, so two simultaneous requests may exceed it by one; it is a cost guard,
/// not a business limit.
/// </remarks>
public sealed partial class RsvpCreateFunction(
    IRsvpRepository repository,
    RsvpSettings settings,
    TimeProvider timeProvider,
    ILogger<RsvpCreateFunction> logger)
{
    /// <summary>Function name (prefix <c>Rsvp</c>: gated by <c>Features__Rsvp</c>).</summary>
    public const string FunctionName = "RsvpCreate";

    /// <summary>Where the created reply can be read.</summary>
    public const string MineLocation = "/api/rsvp/me";

    [Function(FunctionName)]
    public async Task<IActionResult> Run(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "rsvp")] HttpRequest request,
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

        if (await RsvpHttp.AuthenticateAsync(repository, request, cancellationToken) is not null)
        {
            return ApiProblem.Create(StatusCodes.Status409Conflict, ProblemCodes.RsvpExists);
        }

        if (await repository.CountAsync(cancellationToken) >= settings.MaxActiveRsvps)
        {
            LogCapacityReached(logger, settings.MaxActiveRsvps);
            return ApiProblem.Create(StatusCodes.Status503ServiceUnavailable, ProblemCodes.CapacityReached);
        }

        var credential = RsvpCredential.CreateNew();
        var record = new RsvpRecord(credential.RsvpId, PersonIds.Assign(answer, []), credential.TokenHash, now, now);
        var stored = await repository.AddAsync(record, cancellationToken);

        RsvpCookies.Set(response, credential, answer.Attending, settings.CookieLifetime);
        response.Headers.ETag = stored.ETag;
        response.Headers.Location = MineLocation;
        return ApiResult.Json(StatusCodes.Status201Created, new RsvpCreatedResponse(RsvpView.From(stored.Record)));
    }

    [LoggerMessage(Level = LogLevel.Warning, Message = "RSVP capacity of {MaxActiveRsvps} replies reached; new replies are refused.")]
    private static partial void LogCapacityReached(ILogger logger, int maxActiveRsvps);
}
