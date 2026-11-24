using Azure.Monitor.OpenTelemetry.Exporter;

using Microsoft.AspNetCore.Http;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Middleware;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Options;

using Shouldly;

using WeddingPlanner.Api.Pipeline;
using WeddingPlanner.Api.RateLimiting;
using WeddingPlanner.Api.Security;
using WeddingPlanner.Api.Tests.Support;

using Xunit;

namespace WeddingPlanner.Api.Tests.Wiring;

/// <summary>
/// Verifies the composition root in <c>Program.cs</c>: middleware order, gating, lean registrations and
/// telemetry (on only with a connection string; worker sampling default and its app-setting override).
/// </summary>
public sealed class ProgramWiringTests
{
    [Fact]
    public void RegistersTheMiddlewareInPipelineOrder()
    {
        var app = Compose([]);

        var middlewareTypes = app.Services
            .Select(descriptor => descriptor.ServiceType)
            .Where(type => typeof(IFunctionsWorkerMiddleware).IsAssignableFrom(type))
            .ToList();

        middlewareTypes.ShouldBe(
        [
            typeof(ExceptionHandlingMiddleware),
            typeof(FeatureGateMiddleware),
            typeof(RateLimitingMiddleware),
            typeof(RequestOriginGuardMiddleware),
            typeof(AdminAuthorizationMiddleware),
        ]);
        app.Middleware.Count.ShouldBe(5);
    }

    [Fact]
    public async Task HealthRunsThroughTheWholePipelineWithoutAnySetting()
    {
        var app = Compose([]);

        var (httpContext, functionRan) = await app.InvokeAsync("Health");

        functionRan.ShouldBeTrue();
        httpContext.Response.StatusCode.ShouldBe(StatusCodes.Status200OK);
    }

    [Theory]
    [InlineData("RsvpCreate")]
    [InlineData("AdminGuestsList")]
    public async Task FeaturesAreDarkByDefault(string functionName)
    {
        var app = Compose([]);

        var (httpContext, functionRan) = await app.InvokeAsync(functionName);

        functionRan.ShouldBeFalse();
        httpContext.Response.StatusCode.ShouldBe(StatusCodes.Status404NotFound);
    }

    [Fact]
    public async Task AdminAuthorizationAppliesOnlyToAdminFunctions()
    {
        // Without the admin middleware in the container, only invocations that select it can fail.
        var app = Compose(new() { ["Features:Rsvp"] = "true", ["Features:Admin"] = "true" });
        app.Services.RemoveAll<AdminAuthorizationMiddleware>();

        (await app.InvokeAsync("RsvpCreate")).FunctionRan.ShouldBeTrue();
        (await app.InvokeAsync("Health")).FunctionRan.ShouldBeTrue();
        await Should.ThrowAsync<InvalidOperationException>(() => app.InvokeAsync("AdminRsvpsList"));
    }

    [Fact]
    public void TelemetryIsOffWithoutAnApplicationInsightsConnectionString()
    {
        var app = Compose([]);

        app.Services.ShouldNotContain(descriptor => IsOpenTelemetryService(descriptor));
    }

    [Fact]
    public void TelemetryIsOnWithAnApplicationInsightsConnectionString()
    {
        var app = Compose(TelemetrySettings());

        app.Services.ShouldContain(descriptor => IsOpenTelemetryService(descriptor));
    }

    [Fact]
    public void WorkerTracesAreRateLimitedByDefault()
    {
        var options = ResolveExporterOptions(Compose(TelemetrySettings()));

        options.TracesPerSecond.ShouldBe(Program.DefaultWorkerTracesPerSecond);
    }

    [Fact]
    public void SamplerAppSettingsOverrideWorkerSampling()
    {
        // Fails if code starts configuring AzureMonitorExporterOptions: the exporter then ignores these settings.
        var settings = TelemetrySettings();
        settings[Program.TracesSamplerKey] = "microsoft.fixed_percentage";
        settings[Program.TracesSamplerArgumentKey] = "0.25";

        var options = ResolveExporterOptions(Compose(settings));

        options.TracesPerSecond.ShouldBeNull();
        options.SamplingRatio.ShouldBe(0.25f);
    }

    [Fact]
    public void AllRegistrationsResolveWithoutAnySetting()
    {
        var app = Compose([]);

        using var provider = app.Services.BuildServiceProvider(new ServiceProviderOptions { ValidateOnBuild = true, ValidateScopes = true });

        provider.GetRequiredService<TimeProvider>().ShouldBe(TimeProvider.System);
    }

    private static bool IsOpenTelemetryService(ServiceDescriptor descriptor) =>
        descriptor.ServiceType.FullName?.StartsWith("OpenTelemetry.", StringComparison.Ordinal) == true;

    private static Dictionary<string, string?> TelemetrySettings() => new()
    {
        [Program.ApplicationInsightsConnectionStringKey] =
            "InstrumentationKey=00000000-0000-0000-0000-000000000000;IngestionEndpoint=https://example.com/",
    };

    private static AzureMonitorExporterOptions ResolveExporterOptions(RecordingWorkerApplicationBuilder app)
    {
        using var provider = app.Services.BuildServiceProvider();
        return provider.GetRequiredService<IOptionsMonitor<AzureMonitorExporterOptions>>().Get(Options.DefaultName);
    }

    private static RecordingWorkerApplicationBuilder Compose(Dictionary<string, string?> settings)
    {
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(settings).Build();
        var app = new RecordingWorkerApplicationBuilder();
        app.Services.AddSingleton<IConfiguration>(configuration);
        Program.ConfigurePipeline(app);
        Program.ConfigureServices(app.Services, configuration);
        return app;
    }

    /// <summary>Records the worker middleware like the Functions host builder and runs it against a test context.</summary>
    private sealed class RecordingWorkerApplicationBuilder : IFunctionsWorkerApplicationBuilder
    {
        public IServiceCollection Services { get; } = new ServiceCollection();

        public List<Func<FunctionExecutionDelegate, FunctionExecutionDelegate>> Middleware { get; } = [];

        public IFunctionsWorkerApplicationBuilder Use(Func<FunctionExecutionDelegate, FunctionExecutionDelegate> middleware)
        {
            Middleware.Add(middleware);
            return this;
        }

        public async Task<(DefaultHttpContext HttpContext, bool FunctionRan)> InvokeAsync(string functionName)
        {
            var functionRan = false;
            FunctionExecutionDelegate pipeline = _ =>
            {
                functionRan = true;
                return Task.CompletedTask;
            };
            for (var index = Middleware.Count - 1; index >= 0; index--)
            {
                pipeline = Middleware[index](pipeline);
            }

            using var provider = Services.BuildServiceProvider();
            var httpContext = TestFunctionContext.CreateHttpContext();
            await pipeline(new TestFunctionContext(functionName, provider, httpContext));
            return (httpContext, functionRan);
        }
    }
}
