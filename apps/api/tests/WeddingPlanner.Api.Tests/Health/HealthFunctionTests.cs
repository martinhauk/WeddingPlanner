using System.Reflection;
using System.Text.Json;

using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Abstractions;
using Microsoft.AspNetCore.Routing;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Time.Testing;

using Shouldly;

using WeddingPlanner.Api.Features.FeatureFlags;
using WeddingPlanner.Api.Features.Health;

using Xunit;

namespace WeddingPlanner.Api.Tests.Health;

public sealed class HealthFunctionTests
{
    private static readonly DateTimeOffset _now = new(2031, 5, 17, 14, 30, 0, TimeSpan.Zero);

    [Fact]
    public async Task ReturnsOkStatusVersionAndUtcTimeAsCamelCaseJson()
    {
        var function = new HealthFunction(new FakeTimeProvider(_now));
        var httpContext = CreateHttpContext();

        var result = function.Run(httpContext.Request);
        await ExecuteAsync(result, httpContext);

        httpContext.Response.StatusCode.ShouldBe(StatusCodes.Status200OK);
        httpContext.Response.ContentType.ShouldNotBeNull().ShouldStartWith("application/json");
        using var body = JsonDocument.Parse(ReadBody(httpContext));
        body.RootElement.EnumerateObject().Select(property => property.Name).ShouldBe(["status", "version", "timeUtc"]);
        body.RootElement.GetProperty("status").GetString().ShouldBe("ok");
        body.RootElement.GetProperty("version").GetString().ShouldBe(AppVersion.Current);
        body.RootElement.GetProperty("timeUtc").GetString().ShouldBe("2031-05-17T14:30:00Z");
    }

    [Fact]
    public void SetsCacheControlNoStore()
    {
        var httpContext = CreateHttpContext();

        new HealthFunction(new FakeTimeProvider(_now)).Run(httpContext.Request);

        httpContext.Response.Headers.CacheControl.ToString().ShouldBe("no-store");
    }

    [Fact]
    public void VersionIsTheInformationalVersionOfTheApiAssembly()
    {
        var informationalVersion = typeof(HealthFunction).Assembly
            .GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion;

        AppVersion.Current.ShouldBe(informationalVersion);
        AppVersion.Current.ShouldNotBeNullOrWhiteSpace();
    }

    [Fact]
    public void IsAnonymousGetOnApiHealth()
    {
        var method = typeof(HealthFunction).GetMethod(nameof(HealthFunction.Run)).ShouldNotBeNull();
        var trigger = method.GetParameters().Single().GetCustomAttribute<HttpTriggerAttribute>().ShouldNotBeNull();

        method.GetCustomAttribute<FunctionAttribute>().ShouldNotBeNull().Name.ShouldBe("Health");
        trigger.AuthLevel.ShouldBe(AuthorizationLevel.Anonymous);
        trigger.Methods.ShouldBe(["get"]);
        trigger.Route.ShouldBe("health");
    }

    [Fact]
    public void IsNeverFeatureGated()
    {
        FeatureMap.ForFunction(HealthFunction.FunctionName).ShouldBeNull();
    }

    [Fact]
    public void DependsOnNothingButTheClock()
    {
        // No storage client, repository, options or HTTP client can sneak into the keep-warm target.
        var constructor = typeof(HealthFunction).GetConstructors().ShouldHaveSingleItem();

        constructor.GetParameters().Select(parameter => parameter.ParameterType).ShouldBe([typeof(TimeProvider)]);
    }

    [Fact]
    public void AnswersWithTheAppServicesAndNoConfigurationAtAll()
    {
        // No Storage__ConnectionString, no feature flags, no telemetry: health must still work.
        var services = new ServiceCollection();
        var configuration = new ConfigurationBuilder().Build();
        services.AddSingleton<IConfiguration>(configuration);
        Program.ConfigureServices(services, configuration);
        using var provider = services.BuildServiceProvider(new ServiceProviderOptions { ValidateOnBuild = true, ValidateScopes = true });
        var httpContext = CreateHttpContext();

        var function = ActivatorUtilities.CreateInstance<HealthFunction>(provider);
        var result = function.Run(httpContext.Request);

        result.ShouldBeOfType<OkObjectResult>().Value.ShouldBeOfType<HealthResponse>().Status.ShouldBe("ok");
    }

    private static DefaultHttpContext CreateHttpContext()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddMvcCore();
        var httpContext = new DefaultHttpContext { RequestServices = services.BuildServiceProvider() };
        httpContext.Request.Method = HttpMethods.Get;
        httpContext.Request.Path = "/api/health";
        httpContext.Response.Body = new MemoryStream();
        return httpContext;
    }

    /// <summary>Executes the result like the ASP.NET Core integration of the Functions worker does.</summary>
    private static Task ExecuteAsync(IActionResult result, HttpContext httpContext) =>
        result.ExecuteResultAsync(new ActionContext(httpContext, new RouteData(), new ActionDescriptor()));

    private static string ReadBody(HttpContext httpContext)
    {
        httpContext.Response.Body.Position = 0;
        using var reader = new StreamReader(httpContext.Response.Body, leaveOpen: true);
        return reader.ReadToEnd();
    }
}
