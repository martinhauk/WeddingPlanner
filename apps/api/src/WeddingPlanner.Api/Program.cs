using Azure.Monitor.OpenTelemetry.Exporter;

using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Builder;
using Microsoft.Azure.Functions.Worker.OpenTelemetry;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

using WeddingPlanner.Api.Features.Admin.Export;
using WeddingPlanner.Api.Features.Admin.Guests;
using WeddingPlanner.Api.Features.Admin.Matching;
using WeddingPlanner.Api.Features.Admin.Rsvps;
using WeddingPlanner.Api.Features.Admin.Settings;
using WeddingPlanner.Api.Features.FeatureFlags;
using WeddingPlanner.Api.Features.Rsvp;
using WeddingPlanner.Api.Pipeline;
using WeddingPlanner.Api.RateLimiting;
using WeddingPlanner.Api.Security;
using WeddingPlanner.Api.Storage;

// Owned by S0-03. Every middleware and feature registration is pre-wired here, so feature tasks
// only edit their own folder. Keep startup lean: no I/O and no table creation at startup.
var builder = FunctionsApplication.CreateBuilder(args);
builder.ConfigureFunctionsWebApplication();

Program.ConfigurePipeline(builder);
Program.ConfigureServices(builder.Services, builder.Configuration);

builder.Build().Run();

/// <summary>Composition root of the Functions worker (split into methods so tests can verify the wiring).</summary>
internal partial class Program
{
    /// <summary>App setting that switches telemetry on. Without it the worker exports nothing.</summary>
    internal const string ApplicationInsightsConnectionStringKey = "APPLICATIONINSIGHTS_CONNECTION_STRING";

    /// <summary>
    /// Worker trace sampling when no sampler app setting is present: the Azure Monitor exporter's
    /// rate-limited sampler at this many traces per second. This is the exporter's own default
    /// (<c>AzureMonitorExporterOptions.TracesPerSecond</c>, 1.10.0); a wiring test pins it so a package
    /// upgrade cannot change it silently.
    /// </summary>
    internal const double DefaultWorkerTracesPerSecond = 5;

    /// <summary>
    /// Standard OpenTelemetry sampler app settings. They set sampling for the Functions host and, with the
    /// Azure Monitor exporter values <c>microsoft.rate_limited</c> (traces per second) or
    /// <c>microsoft.fixed_percentage</c> (ratio 0..1), for this worker too.
    /// </summary>
    internal const string TracesSamplerKey = "OTEL_TRACES_SAMPLER";

    /// <inheritdoc cref="TracesSamplerKey"/>
    internal const string TracesSamplerArgumentKey = "OTEL_TRACES_SAMPLER_ARG";

    /// <summary>
    /// Worker middleware, outermost first: exception handling → feature gate → rate limiting →
    /// origin guard → admin authorization (<c>Admin*</c> functions only).
    /// </summary>
    internal static void ConfigurePipeline(IFunctionsWorkerApplicationBuilder app)
    {
        app.UseMiddleware<ExceptionHandlingMiddleware>();
        app.UseMiddleware<FeatureGateMiddleware>();
        app.UseMiddleware<RateLimitingMiddleware>();
        app.UseMiddleware<RequestOriginGuardMiddleware>();
        app.UseWhen<AdminAuthorizationMiddleware>(context => FeatureMap.IsAdminFunction(context.FunctionDefinition.Name));
    }

    /// <summary>Service registrations. Every registration is lazy: nothing here performs I/O.</summary>
    internal static void ConfigureServices(IServiceCollection services, IConfiguration configuration)
    {
        services.TryAddSingleton(TimeProvider.System);
        services.AddLogging(logging => logging.SetMinimumLevel(LogLevel.Warning));
        AddTelemetry(services, configuration);

        services.AddFeatureFlags();
        services.AddRateLimiting();
        services.AddStorage();

        services.AddRsvpFeature();
        services.AddAdminRsvpsFeature();
        services.AddAdminGuestsFeature();
        services.AddAdminMatchingFeature();
        services.AddAdminExportFeature();
        services.AddAdminSettingsFeature();
    }

    /// <summary>
    /// OpenTelemetry with the Azure Monitor exporter, only when <c>APPLICATIONINSIGHTS_CONNECTION_STRING</c>
    /// is set (deployed environments). Locally and in tests nothing is exported.
    /// </summary>
    /// <remarks>
    /// Sampling is a deliberate choice: worker traces use the exporter's rate-limited sampler at
    /// <see cref="DefaultWorkerTracesPerSecond"/> traces per second, unless the <c>OTEL_TRACES_SAMPLER</c> /
    /// <c>OTEL_TRACES_SAMPLER_ARG</c> app settings say otherwise. Keep the parameterless
    /// <c>UseAzureMonitorExporter()</c>: with exporter 1.10.0, any code-side configuration of
    /// <c>AzureMonitorExporterOptions</c> (a delegate here or <c>services.Configure</c>) makes the exporter
    /// ignore those app settings, so one setting would no longer tune host and worker together.
    /// <c>ProgramWiringTests</c> pins both the default and the override.
    /// </remarks>
    internal static void AddTelemetry(IServiceCollection services, IConfiguration configuration)
    {
        if (string.IsNullOrWhiteSpace(configuration[ApplicationInsightsConnectionStringKey]))
        {
            return;
        }

        services.AddOpenTelemetry()
            .UseFunctionsWorkerDefaults()
            .UseAzureMonitorExporter();
    }
}
