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
