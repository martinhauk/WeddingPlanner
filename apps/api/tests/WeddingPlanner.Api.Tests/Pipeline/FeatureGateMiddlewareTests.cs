using System.Text.Json;

using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Options;

using Shouldly;

using WeddingPlanner.Api.Features.FeatureFlags;
using WeddingPlanner.Api.Pipeline;
using WeddingPlanner.Api.Tests.Support;

using Xunit;

namespace WeddingPlanner.Api.Tests.Pipeline;

public sealed class FeatureGateMiddlewareTests
{
    [Fact]
    public void TestContextExposesTheHttpContextLikeTheAspNetCoreIntegration()
    {
        TestFunctionContext.HttpContextIsVisibleToGetHttpContext().ShouldBeTrue();
    }

    [Theory]
    [InlineData("RsvpCreate")]
    [InlineData("RsvpStatus")]
    [InlineData("AdminRsvpsList")]
    [InlineData("AdminSettingsGet")]
    public async Task DisabledFeatureAnswers404ProblemJsonWithoutRunningTheFunction(string functionName)
    {
        var (httpContext, functionRan) = await InvokeAsync(functionName, new FeaturesOptions());

        functionRan.ShouldBeFalse();
        httpContext.Response.StatusCode.ShouldBe(StatusCodes.Status404NotFound);
        httpContext.Response.ContentType.ShouldBe("application/problem+json");
        httpContext.Response.Headers.CacheControl.ToString().ShouldBe("no-store");
        httpContext.Response.Headers.ContainsKey("Set-Cookie").ShouldBeFalse();
        using var problem = JsonDocument.Parse(ReadBody(httpContext));
        problem.RootElement.GetProperty("status").GetInt32().ShouldBe(404);
        problem.RootElement.GetProperty("code").GetString().ShouldBe("not_found");
        problem.RootElement.GetProperty("title").GetString().ShouldBe("Not Found");
    }

    [Theory]
    [InlineData("RsvpCreate", true, false)]
    [InlineData("AdminRsvpsList", false, true)]
    public async Task EnabledFeatureRunsTheFunction(string functionName, bool rsvp, bool admin)
    {
        var (httpContext, functionRan) = await InvokeAsync(functionName, new FeaturesOptions { Rsvp = rsvp, Admin = admin });

        functionRan.ShouldBeTrue();
        httpContext.Response.StatusCode.ShouldBe(StatusCodes.Status200OK);
        ReadBody(httpContext).ShouldBeEmpty();
    }

    [Theory]
    [InlineData("RsvpCreate", false, true)]
    [InlineData("AdminRsvpsList", true, false)]
    public async Task EachFlagGatesOnlyItsOwnFeature(string functionName, bool rsvp, bool admin)
    {
        var (httpContext, functionRan) = await InvokeAsync(functionName, new FeaturesOptions { Rsvp = rsvp, Admin = admin });

        functionRan.ShouldBeFalse();
        httpContext.Response.StatusCode.ShouldBe(StatusCodes.Status404NotFound);
    }

    [Theory]
    [InlineData("Health")]
    [InlineData("HealthProbe")]
    public async Task HealthAndProbeAreNeverGated(string functionName)
    {
        var (httpContext, functionRan) = await InvokeAsync(functionName, new FeaturesOptions { Rsvp = false, Admin = false });

        functionRan.ShouldBeTrue();
        httpContext.Response.StatusCode.ShouldBe(StatusCodes.Status200OK);
    }

    private static async Task<(DefaultHttpContext HttpContext, bool FunctionRan)> InvokeAsync(string functionName, FeaturesOptions features)
    {
        var httpContext = TestFunctionContext.CreateHttpContext();
        var context = new TestFunctionContext(functionName, httpContext: httpContext);
        var functionRan = false;
        var middleware = new FeatureGateMiddleware(Options.Create(features));

        await middleware.Invoke(context, _ =>
        {
            functionRan = true;
            return Task.CompletedTask;
        });

        return (httpContext, functionRan);
    }

    private static string ReadBody(HttpContext httpContext)
    {
        httpContext.Response.Body.Position = 0;
        using var reader = new StreamReader(httpContext.Response.Body, leaveOpen: true);
        return reader.ReadToEnd();
    }
}
