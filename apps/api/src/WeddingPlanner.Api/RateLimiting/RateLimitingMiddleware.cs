using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Middleware;

namespace WeddingPlanner.Api.RateLimiting;

/// <summary>
/// Third middleware (after the feature gate, so disabled features never touch counters). Pass-through stub
/// wired by S0-03; S2-05 adds the per-IP sliding windows and the per-instance write backstop.
/// </summary>
public sealed class RateLimitingMiddleware : IFunctionsWorkerMiddleware
{
    public Task Invoke(FunctionContext context, FunctionExecutionDelegate next)
    {
        ArgumentNullException.ThrowIfNull(next);
        return next(context);
    }
}
