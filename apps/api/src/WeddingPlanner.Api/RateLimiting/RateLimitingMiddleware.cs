using System.Globalization;

using Microsoft.AspNetCore.Http;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Middleware;
using Microsoft.Extensions.Options;

using WeddingPlanner.Api.Features.FeatureFlags;
using WeddingPlanner.Api.Http;
using WeddingPlanner.Api.Pipeline;

namespace WeddingPlanner.Api.RateLimiting;

/// <summary>
/// Third middleware (after the feature gate, so disabled features never touch counters): per-client sliding
/// windows for the public RSVP functions, before any storage I/O.
/// </summary>
/// <remarks>
/// <list type="bullet">
///   <item>writes (<c>POST</c>, <c>PUT</c>, <c>PATCH</c>, <c>DELETE</c>): <see cref="RateLimitingOptions.WritesPerClient"/>
///   per <see cref="RateLimitingOptions.WriteWindow"/> per client, and
///   <see cref="RateLimitingOptions.InstanceWritesPerMinute"/> per worker instance for all clients together;</item>
///   <item>reads: <see cref="RateLimitingOptions.ReadsPerClient"/> per <see cref="RateLimitingOptions.ReadWindow"/>.</item>
/// </list>
/// A write the instance backstop refuses gives its per-client permit back. A refused request answers 429
/// <c>rate_limited</c> problem+json with <c>Retry-After</c> in seconds. The client
/// key comes from <see cref="ClientAddress"/> and is never logged. Health, probe and admin functions are not
/// limited here (the admin area is behind the platform login).
/// </remarks>
public sealed class RateLimitingMiddleware : IFunctionsWorkerMiddleware
{
    private const string InstanceKey = "*";

    private readonly string _clientIpHeader;
    private readonly SlidingWindowLimiter _writesPerClient;
    private readonly SlidingWindowLimiter _readsPerClient;
    private readonly SlidingWindowLimiter _instanceWrites;

    public RateLimitingMiddleware(IOptions<RateLimitingOptions> options, TimeProvider timeProvider)
    {
        ArgumentNullException.ThrowIfNull(options);
        var limits = options.Value;

        _clientIpHeader = limits.ClientIpHeader;
        _writesPerClient = new SlidingWindowLimiter(limits.WritesPerClient, limits.WriteWindow, timeProvider);
        _readsPerClient = new SlidingWindowLimiter(limits.ReadsPerClient, limits.ReadWindow, timeProvider);
        _instanceWrites = new SlidingWindowLimiter(limits.InstanceWritesPerMinute, TimeSpan.FromMinutes(1), timeProvider);
    }

    public async Task Invoke(FunctionContext context, FunctionExecutionDelegate next)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(next);

        if (FeatureMap.ForFunction(context.FunctionDefinition.Name) == ApiFeature.Rsvp
            && context.GetHttpContext() is { } httpContext
            && !TryAcquire(httpContext.Request, out var retryAfter))
        {
            var response = httpContext.Response;
            response.Headers.CacheControl = "no-store";
            response.Headers.RetryAfter = ((int)Math.Ceiling(retryAfter.TotalSeconds)).ToString(CultureInfo.InvariantCulture);
            await ApiProblem.Create(StatusCodes.Status429TooManyRequests, ProblemCodes.RateLimited)
                .WriteAsync(response, context.CancellationToken);
            return;
        }

        await next(context);
    }

    private bool TryAcquire(HttpRequest request, out TimeSpan retryAfter)
    {
        var key = ClientAddress.ResolveKey(request, _clientIpHeader);
        if (!RequestOriginGuardMiddleware.IsWrite(request.Method))
        {
            return _readsPerClient.TryAcquire(key, out retryAfter);
        }

        // The client's own limit first, so a client refused by it never uses up the shared instance budget.
        if (!_writesPerClient.TryAcquire(key, out retryAfter))
        {
            return false;
        }

        if (_instanceWrites.TryAcquire(InstanceKey, out retryAfter))
        {
            return true;
        }

        // Refused by the backstop: give the client's permit back, so the refusal neither costs that client quota nor
        // leaves a key behind.
        _writesPerClient.Release(key);
        return false;
    }
}
