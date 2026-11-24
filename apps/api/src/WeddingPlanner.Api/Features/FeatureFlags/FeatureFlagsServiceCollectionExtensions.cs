using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace WeddingPlanner.Api.Features.FeatureFlags;

/// <summary>Registers <see cref="FeaturesOptions"/>.</summary>
public static class FeatureFlagsServiceCollectionExtensions
{
    /// <summary>
    /// Binds <see cref="FeaturesOptions"/> from the <c>Features</c> section. A flag is on only when its value
    /// parses as <see langword="true"/>; a missing, empty or malformed value keeps the feature off (fail closed)
    /// instead of breaking the host.
    /// </summary>
    public static IServiceCollection AddFeatureFlags(this IServiceCollection services)
    {
        services.AddOptions<FeaturesOptions>()
            .Configure<IConfiguration>((options, configuration) =>
            {
                var section = configuration.GetSection(FeaturesOptions.SectionName);
                options.Rsvp = IsOn(section[nameof(FeaturesOptions.Rsvp)]);
                options.Admin = IsOn(section[nameof(FeaturesOptions.Admin)]);
            });

        return services;
    }

    private static bool IsOn(string? value) => bool.TryParse(value?.Trim(), out var on) && on;
}
