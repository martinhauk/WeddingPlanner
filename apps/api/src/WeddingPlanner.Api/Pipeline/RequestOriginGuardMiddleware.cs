using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Middleware;

namespace WeddingPlanner.Api.Pipeline;

/// <summary>
/// Fourth middleware (after rate limiting). Pass-through stub wired by S0-03; S2-02 adds the CSRF and
/// origin checks (JSON-only bodies, <c>Sec-Fetch-Site: cross-site</c> rejected on writes, no CORS).
/// </summary>
public sealed class RequestOriginGuardMiddleware : IFunctionsWorkerMiddleware
{
    public Task Invoke(FunctionContext context, FunctionExecutionDelegate next)
    {
        ArgumentNullException.ThrowIfNull(next);
        return next(context);
    }
}
