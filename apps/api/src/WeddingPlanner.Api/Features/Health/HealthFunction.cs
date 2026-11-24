using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;

namespace WeddingPlanner.Api.Features.Health;

/// <summary>
/// <c>GET /api/health</c>: anonymous liveness and version check. It is the keep-warm target of the web app
/// and the smoke-test target, so it stays trivially cheap: no I/O, no storage, no settings, never gated.
/// </summary>
public sealed class HealthFunction(TimeProvider timeProvider)
{
    /// <summary>Function name (no <c>Rsvp</c>/<c>Admin</c> prefix, so the feature gate never applies).</summary>
    public const string FunctionName = "Health";

    [Function(FunctionName)]
    public IActionResult Run(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "health")] HttpRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);

        request.HttpContext.Response.Headers.CacheControl = "no-store";
        return new OkObjectResult(new HealthResponse("ok", AppVersion.Current, timeProvider.GetUtcNow().UtcDateTime));
    }
}
