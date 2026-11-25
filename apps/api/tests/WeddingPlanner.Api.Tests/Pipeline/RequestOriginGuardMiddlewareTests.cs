using Microsoft.AspNetCore.Http;

using Shouldly;

using WeddingPlanner.Api.Pipeline;
using WeddingPlanner.Api.Tests.Support;

using Xunit;

namespace WeddingPlanner.Api.Tests.Pipeline;

public sealed class RequestOriginGuardMiddlewareTests
{
    [Theory]
    [InlineData("POST")]
    [InlineData("PUT")]
    [InlineData("PATCH")]
    [InlineData("DELETE")]
    public async Task RejectsCrossSiteWrites(string method)
    {
        var (httpContext, ran) = await InvokeAsync("RsvpCreate", method, headers: new() { ["Sec-Fetch-Site"] = "cross-site" });

        ran.ShouldBeFalse();
        httpContext.Response.StatusCode.ShouldBe(StatusCodes.Status403Forbidden);
        httpContext.Response.ContentType.ShouldBe("application/problem+json");
        httpContext.Response.Headers.CacheControl.ToString().ShouldBe("no-store");
        TestHttp.ReadJson(httpContext).GetProperty("code").GetString().ShouldBe("cross_site_request");
    }

    [Theory]
    [InlineData("same-origin")]
    [InlineData("same-site")]
    [InlineData("none")]
    [InlineData(null)]
    public async Task AllowsWritesFromTheSiteItselfOrWithoutFetchMetadata(string? secFetchSite)
    {
        var headers = secFetchSite is null ? new Dictionary<string, string>() : new() { ["Sec-Fetch-Site"] = secFetchSite };

        var (_, ran) = await InvokeAsync("RsvpCreate", "POST", headers: headers);

        ran.ShouldBeTrue();
    }

    [Fact]
    public async Task AllowsCrossSiteReads()
    {
        var (_, ran) = await InvokeAsync("RsvpStatus", "GET", body: null, headers: new() { ["Sec-Fetch-Site"] = "cross-site" });

        ran.ShouldBeTrue();
    }

    [Fact]
    public async Task ChecksAdminWritesToo()
    {
        var (httpContext, ran) = await InvokeAsync("AdminRsvpsUpdate", "PUT", headers: new() { ["Sec-Fetch-Site"] = "cross-site" });

        ran.ShouldBeFalse();
        httpContext.Response.StatusCode.ShouldBe(StatusCodes.Status403Forbidden);
    }

    [Theory]
    [InlineData("Health")]
    [InlineData("HealthProbe")]
    public async Task NeverChecksUngatedFunctions(string functionName)
    {
        var (_, ran) = await InvokeAsync(functionName, "POST", contentType: "text/plain", headers: new() { ["Sec-Fetch-Site"] = "cross-site" });

        ran.ShouldBeTrue();
    }

    [Theory]
    [InlineData("text/plain")]
    [InlineData("application/x-www-form-urlencoded")]
    [InlineData("multipart/form-data; boundary=x")]
    [InlineData("application/json; charset=utf-16")]
    [InlineData("application/jsonp")]
    [InlineData(null)]
    public async Task RejectsBodiesThatAreNotJson(string? contentType)
    {
        var (httpContext, ran) = await InvokeAsync("RsvpCreate", "POST", contentType: contentType);

        ran.ShouldBeFalse();
        httpContext.Response.StatusCode.ShouldBe(StatusCodes.Status415UnsupportedMediaType);
        TestHttp.ReadJson(httpContext).GetProperty("code").GetString().ShouldBe("unsupported_media_type");
    }

    [Theory]
    [InlineData("application/json")]
    [InlineData("application/json; charset=utf-8")]
    [InlineData("Application/JSON; charset=UTF-8")]
    public async Task AcceptsJson(string contentType)
    {
        var (_, ran) = await InvokeAsync("RsvpUpdateMine", "PUT", contentType: contentType);

        ran.ShouldBeTrue();
    }

    [Fact]
    public async Task ADeleteMayHaveNoBody()
    {
        var (_, ran) = await InvokeAsync("RsvpDeleteMine", "DELETE", body: null, contentType: null);

        ran.ShouldBeTrue();
    }

    [Fact]
    public async Task ADeleteBodyMustBeJson()
    {
        var (httpContext, ran) = await InvokeAsync("RsvpDeleteMine", "DELETE", body: "x", contentType: "text/plain");

        ran.ShouldBeFalse();
        httpContext.Response.StatusCode.ShouldBe(StatusCodes.Status415UnsupportedMediaType);
    }

    [Fact]
    public async Task RejectsRsvpBodiesOverSixteenKilobytes()
    {
        var (httpContext, ran) = await InvokeAsync("RsvpCreate", "POST", contentLength: (16 * 1024) + 1);

        ran.ShouldBeFalse();
        httpContext.Response.StatusCode.ShouldBe(StatusCodes.Status413PayloadTooLarge);
        var problem = TestHttp.ReadJson(httpContext);
        problem.GetProperty("code").GetString().ShouldBe("payload_too_large");
        problem.GetProperty("maxBytes").GetInt32().ShouldBe(16 * 1024);
    }

    [Fact]
    public async Task AcceptsAnRsvpBodyOfExactlySixteenKilobytes()
    {
        var (_, ran) = await InvokeAsync("RsvpCreate", "POST", contentLength: 16 * 1024);

        ran.ShouldBeTrue();
    }

    [Fact]
    public async Task AdminBodiesHaveTheirOwnLimit()
    {
        (await InvokeAsync("AdminGuestsImport", "POST", contentLength: (16 * 1024) + 1)).FunctionRan.ShouldBeTrue();
        (await InvokeAsync("AdminGuestsImport", "POST", contentLength: RequestOriginGuardMiddleware.AdminMaxBodyBytes + 1)).FunctionRan.ShouldBeFalse();
    }

    private static async Task<(DefaultHttpContext HttpContext, bool FunctionRan)> InvokeAsync(
        string functionName,
        string method,
        string? body = "{}",
        string? contentType = "application/json",
        long? contentLength = null,
        Dictionary<string, string>? headers = null)
    {
        var httpContext = TestHttp.Request(method, "/api/test", rawBody: body, contentType: contentType, headers: headers);
        if (contentLength is not null)
        {
            httpContext.Request.ContentLength = contentLength;
        }

        var functionRan = false;
        await new RequestOriginGuardMiddleware().Invoke(new TestFunctionContext(functionName, httpContext: httpContext), _ =>
        {
            functionRan = true;
            return Task.CompletedTask;
        });

        return (httpContext, functionRan);
    }
}
