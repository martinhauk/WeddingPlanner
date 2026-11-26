using Microsoft.AspNetCore.Http;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Middleware;

using WeddingPlanner.Api.Http;

namespace WeddingPlanner.Api.Security;

/// <summary>
/// Innermost middleware, applied only to <c>Admin*</c> functions (<c>UseWhen</c> in <c>Program.cs</c>). The SWA route
/// rule on <c>/api/admin*</c> already requires role <c>admin</c>; the API checks again from the
/// <c>x-ms-client-principal</c> header: 401 <c>unauthorized</c> without a (valid) principal, 403 <c>forbidden</c>
/// unless it has role <c>admin</c> and provider <c>aad</c>. Both answers are problem+json with
/// <c>Cache-Control: no-store</c>, and the function never runs. Nothing about the user is logged.
/// </summary>
public sealed class AdminAuthorizationMiddleware : IFunctionsWorkerMiddleware
{
    public async Task Invoke(FunctionContext context, FunctionExecutionDelegate next)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(next);

        // Every admin function is an HTTP function; without an HTTP context there is nobody to authorise.
        if (context.GetHttpContext() is not { } httpContext)
        {
            return;
        }

        var refusal = Authorize(httpContext.Request);
        if (refusal is null)
        {
            await next(context);
            return;
        }

        httpContext.Response.Headers.CacheControl = "no-store";
        await refusal.WriteAsync(httpContext.Response, context.CancellationToken);
    }

    /// <summary>The 401 or 403 response for <paramref name="request"/>, or <see langword="null"/> when it comes from an admin.</summary>
    public static ApiResult? Authorize(HttpRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);

        if (!ClientPrincipal.TryParse(request.Headers[ClientPrincipal.HeaderName].ToString(), out var principal))
        {
            return ApiProblem.Create(StatusCodes.Status401Unauthorized, ProblemCodes.Unauthorized);
        }

        return principal.IsAdmin ? null : ApiProblem.Create(StatusCodes.Status403Forbidden, ProblemCodes.Forbidden);
    }
}
