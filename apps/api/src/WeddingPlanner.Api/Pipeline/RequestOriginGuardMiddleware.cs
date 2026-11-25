using Microsoft.AspNetCore.Http;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Middleware;

using WeddingPlanner.Api.Features.FeatureFlags;
using WeddingPlanner.Api.Http;

namespace WeddingPlanner.Api.Pipeline;

/// <summary>
/// Fourth middleware (after rate limiting): CSRF and body checks for writes to the gated features
/// (<c>Rsvp*</c>, <c>Admin*</c>). Health and probe functions are never checked.
/// </summary>
/// <remarks>
/// For <c>POST</c>, <c>PUT</c>, <c>PATCH</c> and <c>DELETE</c>, in this order:
/// <list type="number">
///   <item><c>Sec-Fetch-Site: cross-site</c> → 403 <c>cross_site_request</c> (browsers send it on every request;
///   <c>same-origin</c>, <c>same-site</c>, <c>none</c> and a missing header pass);</item>
///   <item>a body that is not <c>application/json</c> (UTF-8) → 415 <c>unsupported_media_type</c> (a body is
///   required for <c>POST</c>, <c>PUT</c> and <c>PATCH</c>; a <c>DELETE</c> may have none);</item>
///   <item><c>Content-Length</c> above the feature's limit → 413 <c>payload_too_large</c>. The function's body
///   reader (<see cref="JsonBody"/>) enforces the same limit for bodies without a length.</item>
/// </list>
/// Together with <c>SameSite=Strict</c> cookies and no CORS headers (the API never sends any), this blocks
/// cross-site writes: a cross-site JSON request needs a preflight that the API does not answer.
/// </remarks>
public sealed class RequestOriginGuardMiddleware : IFunctionsWorkerMiddleware
{
    /// <summary>Largest body of an RSVP request (16 KB).</summary>
    public const int RsvpMaxBodyBytes = 16 * 1024;

    /// <summary>Largest body of an admin request (256 KB, room for a guest list import).</summary>
    public const int AdminMaxBodyBytes = 256 * 1024;

    public async Task Invoke(FunctionContext context, FunctionExecutionDelegate next)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(next);

        var feature = FeatureMap.ForFunction(context.FunctionDefinition.Name);
        if (feature is not null && context.GetHttpContext() is { } httpContext
            && Check(httpContext.Request, MaxBodyBytes(feature.Value)) is { } problem)
        {
            httpContext.Response.Headers.CacheControl = "no-store";
            await problem.WriteAsync(httpContext.Response, context.CancellationToken);
            return;
        }

        await next(context);
    }

    /// <summary>The body limit of a feature.</summary>
    public static int MaxBodyBytes(ApiFeature feature) => feature == ApiFeature.Admin ? AdminMaxBodyBytes : RsvpMaxBodyBytes;

    /// <summary>Whether <paramref name="method"/> changes state.</summary>
    public static bool IsWrite(string method) =>
        HttpMethods.IsPost(method) || HttpMethods.IsPut(method) || HttpMethods.IsPatch(method) || HttpMethods.IsDelete(method);

    /// <summary>Returns the problem to answer with, or <see langword="null"/> when the request may proceed.</summary>
    internal static ApiResult? Check(HttpRequest request, int maxBodyBytes)
    {
        if (!IsWrite(request.Method))
        {
            return null;
        }

        if (string.Equals(request.Headers["Sec-Fetch-Site"].ToString().Trim(), "cross-site", StringComparison.OrdinalIgnoreCase))
        {
            return ApiProblem.Create(StatusCodes.Status403Forbidden, ProblemCodes.CrossSiteRequest);
        }

        var bodyRequired = !HttpMethods.IsDelete(request.Method);
        var hasBody = request.ContentLength > 0 || request.Headers.TransferEncoding.Count > 0;
        if ((bodyRequired || hasBody) && !JsonBody.IsJson(request.ContentType))
        {
            return ApiProblem.Create(StatusCodes.Status415UnsupportedMediaType, ProblemCodes.UnsupportedMediaType);
        }

        if (request.ContentLength > maxBodyBytes)
        {
            return ApiProblem.Create(
                StatusCodes.Status413PayloadTooLarge,
                ProblemCodes.PayloadTooLarge,
                extensions: new Dictionary<string, object?> { ["maxBytes"] = maxBodyBytes });
        }

        return null;
    }
}
