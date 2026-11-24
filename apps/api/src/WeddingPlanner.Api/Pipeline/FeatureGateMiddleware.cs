using System.Text.Json;

using Microsoft.AspNetCore.Http;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Middleware;
using Microsoft.Extensions.Options;

using WeddingPlanner.Api.Features.FeatureFlags;

namespace WeddingPlanner.Api.Pipeline;

/// <summary>
/// Second middleware (after exception handling). A function whose feature is switched off answers
/// 404 <c>not_found</c> as problem+json and never runs: no rate-limit counters, no storage I/O, no cookies.
/// Functions without a feature prefix (health, probe) are never gated. See <see cref="FeatureMap"/>.
/// </summary>
public sealed class FeatureGateMiddleware(IOptions<FeaturesOptions> options) : IFunctionsWorkerMiddleware
{
    /// <summary>Media type of RFC 9457 problem details.</summary>
    public const string ProblemJsonContentType = "application/problem+json";

    private static readonly byte[] _notFoundBody = JsonSerializer.SerializeToUtf8Bytes(new
    {
        type = "https://tools.ietf.org/html/rfc9110#section-15.5.5",
        title = "Not Found",
        status = StatusCodes.Status404NotFound,
        code = "not_found",
    });

    public async Task Invoke(FunctionContext context, FunctionExecutionDelegate next)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(next);

        var feature = FeatureMap.ForFunction(context.FunctionDefinition.Name);
        if (feature is null || options.Value.IsEnabled(feature.Value))
        {
            await next(context);
            return;
        }

        // Feature is off: short-circuit before any other middleware or the function itself runs.
        if (context.GetHttpContext() is { } httpContext)
        {
            await WriteNotFoundAsync(httpContext.Response, context.CancellationToken);
        }
    }

    private static async Task WriteNotFoundAsync(HttpResponse response, CancellationToken cancellationToken)
    {
        response.StatusCode = StatusCodes.Status404NotFound;
        response.ContentType = ProblemJsonContentType;
        response.Headers.CacheControl = "no-store";
        response.ContentLength = _notFoundBody.Length;
        await response.Body.WriteAsync(_notFoundBody, cancellationToken);
    }
}
