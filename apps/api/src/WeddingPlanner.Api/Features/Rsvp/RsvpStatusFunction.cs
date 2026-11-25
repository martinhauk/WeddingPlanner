using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;

using WeddingPlanner.Api.Http;

namespace WeddingPlanner.Api.Features.Rsvp;

/// <summary>
/// <c>GET /api/rsvp/status</c>: <c>{enabled, open, full, deadline, timeZone, limits}</c> for the RSVP page. No
/// cookies and no personal data. The answer is cached in memory for <see cref="RsvpStatusCache.Lifetime"/> and may be
/// cached by the browser for as long, so <c>open</c> can lag the deadline by up to a minute; writes check the
/// deadline exactly.
/// </summary>
public sealed class RsvpStatusFunction(RsvpStatusCache cache)
{
    /// <summary>Function name (prefix <c>Rsvp</c>: gated by <c>Features__Rsvp</c>).</summary>
    public const string FunctionName = "RsvpStatus";

    [Function(FunctionName)]
    public async Task<IActionResult> Run(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "rsvp/status")] HttpRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var status = await cache.GetAsync(cancellationToken);
        request.HttpContext.Response.Headers.CacheControl = $"public, max-age={(int)RsvpStatusCache.Lifetime.TotalSeconds}";
        return ApiResult.Json(StatusCodes.Status200OK, status);
    }
}
