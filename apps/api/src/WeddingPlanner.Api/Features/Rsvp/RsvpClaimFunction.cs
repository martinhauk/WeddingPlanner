using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;

using WeddingPlanner.Api.Http;
using WeddingPlanner.Api.Pipeline;
using WeddingPlanner.Api.Storage.Rsvps;

namespace WeddingPlanner.Api.Features.Rsvp;

/// <summary>
/// <c>POST /api/rsvp/claim</c> with <c>{editToken}</c>: turns the personal edit link (<c>/#edit=&lt;rsvpId&gt;.&lt;token&gt;</c>,
/// from the 201 of <c>POST /api/rsvp</c>) into the RSVP cookies of this browser, so a guest who replied in a
/// messenger's in-app browser or on another device can see, change and withdraw the reply here. Answers 200
/// <c>{rsvp, version, open, deadline}</c> with <c>ETag</c>, like <c>GET /api/rsvp/me</c>, and sets both cookies
/// (replacing any this browser held for another reply).
/// </summary>
/// <remarks>
/// <list type="bullet">
///   <item>A malformed token, an unknown id, a wrong token and a deleted (withdrawn) reply all answer the same 404
///   <c>not_found</c>, so the response never reveals whether a reply id exists. The token is compared in constant
///   time, against a decoy hash when the id is unknown (<see cref="RsvpHttp.ResolveAsync"/>). A 404 leaves this
///   browser's cookies alone: a mistyped link must not make it forget its own reply.</item>
///   <item>Works after the deadline too (the reply is then read-only, <c>open: false</c>), like <c>GET /me</c>.</item>
///   <item>A write for the pipeline (<c>POST</c>, prefix <c>Rsvp</c>): gated by <c>Features__Rsvp</c>, rate-limited like
///   every write (a wrong token costs the same permit as a right one), JSON only and same-site only.</item>
///   <item>The token is never logged.</item>
/// </list>
/// </remarks>
public sealed class RsvpClaimFunction(IRsvpRepository repository, RsvpSettings settings, TimeProvider timeProvider)
{
    /// <summary>Function name (prefix <c>Rsvp</c>: gated by <c>Features__Rsvp</c>).</summary>
    public const string FunctionName = "RsvpClaim";

    [Function(FunctionName)]
    public async Task<IActionResult> Run(
        [HttpTrigger(AuthorizationLevel.Anonymous, "post", Route = "rsvp/claim")] HttpRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var response = request.HttpContext.Response;
        RsvpHttp.NoStore(response);

        if (!repository.IsConfigured)
        {
            return RsvpHttp.NotConfigured();
        }

        var body = await JsonBody.ReadAsync<RsvpClaimRequest>(request, RequestOriginGuardMiddleware.RsvpMaxBodyBytes, cancellationToken);
        if (!body.TryGetValue(out var input, out var bodyProblem))
        {
            return bodyProblem;
        }

        if (!RsvpCredential.TryParse(input.EditToken, out var credential)
            || await RsvpHttp.ResolveAsync(repository, credential, cancellationToken) is not { } session)
        {
            return ApiProblem.Create(StatusCodes.Status404NotFound, ProblemCodes.NotFound);
        }

        return RsvpHttp.Mine(response, session.Credential, session.Stored, settings, timeProvider.GetUtcNow());
    }
}
