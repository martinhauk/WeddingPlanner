using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Middleware;

namespace WeddingPlanner.Api.Pipeline;

/// <summary>
/// Outermost middleware. Pass-through stub wired by S0-03; S2-02 maps unhandled exceptions to
/// 500 <c>internal_error</c> problem details without exception details.
/// </summary>
public sealed class ExceptionHandlingMiddleware : IFunctionsWorkerMiddleware
{
    public Task Invoke(FunctionContext context, FunctionExecutionDelegate next)
    {
        ArgumentNullException.ThrowIfNull(next);
        return next(context);
    }
}
