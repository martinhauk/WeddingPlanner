using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Middleware;

namespace WeddingPlanner.Api.Security;

/// <summary>
/// Innermost middleware, applied only to <c>Admin*</c> functions (<c>UseWhen</c> in <c>Program.cs</c>).
/// Pass-through stub wired by S0-03; S3-01 parses <c>x-ms-client-principal</c> and requires role
/// <c>admin</c> and provider <c>aad</c> (401 without principal, 403 otherwise).
/// </summary>
public sealed class AdminAuthorizationMiddleware : IFunctionsWorkerMiddleware
{
    public Task Invoke(FunctionContext context, FunctionExecutionDelegate next)
    {
        ArgumentNullException.ThrowIfNull(next);
        return next(context);
    }
}
