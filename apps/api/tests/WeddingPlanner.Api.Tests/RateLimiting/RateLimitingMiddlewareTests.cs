using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Microsoft.Extensions.Time.Testing;

using Shouldly;

using WeddingPlanner.Api.RateLimiting;
using WeddingPlanner.Api.Tests.Support;

using Xunit;

namespace WeddingPlanner.Api.Tests.RateLimiting;

/// <summary>Documentation addresses only (RFC 5737).</summary>
public sealed class RateLimitingMiddlewareTests
{
    private readonly FakeTimeProvider _time = new(new DateTimeOffset(2099, 4, 1, 10, 0, 0, TimeSpan.Zero));

    [Fact]
    public async Task AllowsTenWritesPerClientInTenMinutes()
    {
        var middleware = Middleware();

        for (var index = 0; index < 10; index++)
        {
            (await InvokeAsync(middleware, "RsvpCreate", "POST", "203.0.113.1")).FunctionRan.ShouldBeTrue();
        }

        var (httpContext, ran) = await InvokeAsync(middleware, "RsvpUpdateMine", "PUT", "203.0.113.1");

        ran.ShouldBeFalse();
        httpContext.Response.StatusCode.ShouldBe(StatusCodes.Status429TooManyRequests);
        httpContext.Response.ContentType.ShouldBe("application/problem+json");
        httpContext.Response.Headers.CacheControl.ToString().ShouldBe("no-store");
        httpContext.Response.Headers.RetryAfter.ToString().ShouldBe("600");
        TestHttp.ReadJson(httpContext).GetProperty("code").GetString().ShouldBe("rate_limited");
        TestHttp.ReadBody(httpContext).ShouldNotContain("203.0.113.1");

        _time.Advance(TimeSpan.FromMinutes(10));
        (await InvokeAsync(middleware, "RsvpDeleteMine", "DELETE", "203.0.113.1")).FunctionRan.ShouldBeTrue();
    }

    [Fact]
    public async Task ClientsAreLimitedSeparately()
    {
        var middleware = Middleware();
        for (var index = 0; index < 10; index++)
        {
            await InvokeAsync(middleware, "RsvpCreate", "POST", "203.0.113.1");
        }

        (await InvokeAsync(middleware, "RsvpCreate", "POST", "203.0.113.2")).FunctionRan.ShouldBeTrue();
        (await InvokeAsync(middleware, "RsvpCreate", "POST", "203.0.113.1")).FunctionRan.ShouldBeFalse();
    }

    [Fact]
    public async Task ReadsHaveTheirOwnLargerBudget()
    {
        var middleware = Middleware();
        for (var index = 0; index < 10; index++)
        {
            await InvokeAsync(middleware, "RsvpCreate", "POST", "203.0.113.1");
        }

        for (var index = 0; index < 60; index++)
        {
            (await InvokeAsync(middleware, "RsvpStatus", "GET", "203.0.113.1")).FunctionRan.ShouldBeTrue();
        }

        var (httpContext, ran) = await InvokeAsync(middleware, "RsvpGetMine", "GET", "203.0.113.1");
        ran.ShouldBeFalse();
        httpContext.Response.Headers.RetryAfter.ToString().ShouldBe("60");
    }

    [Fact]
    public async Task TheInstanceBackstopLimitsWritesFromAllClients()
    {
        var middleware = Middleware(new() { ["RateLimiting:InstanceWritesPerMinute"] = "3" });

        for (var index = 1; index <= 3; index++)
        {
            (await InvokeAsync(middleware, "RsvpCreate", "POST", $"203.0.113.{index}")).FunctionRan.ShouldBeTrue();
        }

        (await InvokeAsync(middleware, "RsvpCreate", "POST", "203.0.113.4")).FunctionRan.ShouldBeFalse();
        (await InvokeAsync(middleware, "RsvpStatus", "GET", "203.0.113.4")).FunctionRan.ShouldBeTrue("reads are not part of the backstop");
    }

    [Fact]
    public async Task AWriteRefusedByTheBackstopCostsTheClientNothing()
    {
        var middleware = Middleware(new() { ["RateLimiting:WritesPerClient"] = "2", ["RateLimiting:InstanceWritesPerMinute"] = "1" });
        (await InvokeAsync(middleware, "RsvpCreate", "POST", "203.0.113.1")).FunctionRan.ShouldBeTrue();

        for (var index = 0; index < 5; index++)
        {
            var (httpContext, ran) = await InvokeAsync(middleware, "RsvpCreate", "POST", "203.0.113.2");
            ran.ShouldBeFalse();
            httpContext.Response.StatusCode.ShouldBe(StatusCodes.Status429TooManyRequests);
        }

        _time.Advance(TimeSpan.FromMinutes(1));
        (await InvokeAsync(middleware, "RsvpCreate", "POST", "203.0.113.2")).FunctionRan.ShouldBeTrue();
        _time.Advance(TimeSpan.FromMinutes(1));
        (await InvokeAsync(middleware, "RsvpCreate", "POST", "203.0.113.2")).FunctionRan.ShouldBeTrue("the refused writes did not use up the client's two permits");
        _time.Advance(TimeSpan.FromMinutes(1));
        (await InvokeAsync(middleware, "RsvpCreate", "POST", "203.0.113.2")).FunctionRan.ShouldBeFalse("now the client limit applies");
    }

    [Fact]
    public async Task AWriteRefusedByTheClientLimitDoesNotUseTheInstanceBudget()
    {
        var middleware = Middleware(new() { ["RateLimiting:WritesPerClient"] = "1", ["RateLimiting:InstanceWritesPerMinute"] = "2" });
        (await InvokeAsync(middleware, "RsvpCreate", "POST", "203.0.113.1")).FunctionRan.ShouldBeTrue();

        for (var index = 0; index < 5; index++)
        {
            (await InvokeAsync(middleware, "RsvpCreate", "POST", "203.0.113.1")).FunctionRan.ShouldBeFalse();
        }

        (await InvokeAsync(middleware, "RsvpCreate", "POST", "203.0.113.2")).FunctionRan.ShouldBeTrue();
    }

    [Theory]
    [InlineData("Health", "GET")]
    [InlineData("HealthProbe", "GET")]
    [InlineData("AdminRsvpsUpdate", "PUT")]
    public async Task OnlyLimitsTheRsvpFunctions(string functionName, string method)
    {
        var middleware = Middleware();

        for (var index = 0; index < 100; index++)
        {
            (await InvokeAsync(middleware, functionName, method, "203.0.113.1")).FunctionRan.ShouldBeTrue();
        }
    }

    [Fact]
    public void BindsTheOptionsLeniently()
    {
        var options = Options(new()
        {
            ["RateLimiting:WritesPerClient"] = "5",
            ["RateLimiting:WriteWindowSeconds"] = "120",
            ["RateLimiting:ReadsPerClient"] = "-1",
            ["RateLimiting:ReadWindowSeconds"] = "soon",
            ["RateLimiting:InstanceWritesPerMinute"] = "99999999999",
            ["RateLimiting:ClientIpHeader"] = " x-client-ip ",
        });

        options.WritesPerClient.ShouldBe(5);
        options.WriteWindow.ShouldBe(TimeSpan.FromMinutes(2));
        options.ReadsPerClient.ShouldBe(60);
        options.ReadWindow.ShouldBe(TimeSpan.FromMinutes(1));
        options.InstanceWritesPerMinute.ShouldBe(120);
        options.ClientIpHeader.ShouldBe("x-client-ip");
    }

    [Fact]
    public void HasCodeDefaults()
    {
        var options = Options([]);

        options.WritesPerClient.ShouldBe(10);
        options.WriteWindow.ShouldBe(TimeSpan.FromMinutes(10));
        options.ReadsPerClient.ShouldBe(60);
        options.ReadWindow.ShouldBe(TimeSpan.FromMinutes(1));
        options.InstanceWritesPerMinute.ShouldBe(120);
        options.ClientIpHeader.ShouldBe("x-azure-clientip");
    }

    private RateLimitingMiddleware Middleware(Dictionary<string, string?>? settings = null) =>
        new(Microsoft.Extensions.Options.Options.Create(Options(settings ?? [])), _time);

    private static RateLimitingOptions Options(Dictionary<string, string?> settings)
    {
        var services = new ServiceCollection();
        services.AddSingleton<IConfiguration>(new ConfigurationBuilder().AddInMemoryCollection(settings).Build());
        services.AddRateLimiting();
        using var provider = services.BuildServiceProvider();
        return provider.GetRequiredService<IOptions<RateLimitingOptions>>().Value;
    }

    private static async Task<(DefaultHttpContext HttpContext, bool FunctionRan)> InvokeAsync(
        RateLimitingMiddleware middleware,
        string functionName,
        string method,
        string clientAddress)
    {
        var httpContext = TestFunctionContext.CreateHttpContext();
        httpContext.Request.Method = method;
        httpContext.Request.Headers["X-Azure-ClientIP"] = clientAddress;

        var functionRan = false;
        await middleware.Invoke(new TestFunctionContext(functionName, httpContext: httpContext), _ =>
        {
            functionRan = true;
            return Task.CompletedTask;
        });

        return (httpContext, functionRan);
    }
}
