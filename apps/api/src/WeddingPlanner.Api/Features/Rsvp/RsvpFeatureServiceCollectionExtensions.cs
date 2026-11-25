using System.Globalization;

using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

using WeddingPlanner.Api.Storage.Rsvps;
using WeddingPlanner.Domain.Rsvp;

namespace WeddingPlanner.Api.Features.Rsvp;

/// <summary>Public RSVP feature registrations, called from <c>Program.cs</c>.</summary>
public static class RsvpFeatureServiceCollectionExtensions
{
    /// <summary>
    /// Binds <see cref="RsvpOptions"/> and registers the RSVP services. Everything is lazy: no I/O, and the
    /// deadline is parsed on first use.
    /// </summary>
    public static IServiceCollection AddRsvpFeature(this IServiceCollection services)
    {
        services.AddOptions<RsvpOptions>()
            .Configure<IConfiguration>((options, configuration) =>
            {
                var section = configuration.GetSection(RsvpOptions.SectionName);
                options.Deadline = section[nameof(RsvpOptions.Deadline)]?.Trim();
                if (section[nameof(RsvpOptions.TimeZone)] is { } timeZone && !string.IsNullOrWhiteSpace(timeZone))
                {
                    options.TimeZone = timeZone.Trim();
                }

                options.MaxCompanions = ReadInt(section, nameof(RsvpOptions.MaxCompanions), options.MaxCompanions, 0, RsvpLimits.MaxCompanionsCeiling);
                options.MaxActiveRsvps = ReadInt(section, nameof(RsvpOptions.MaxActiveRsvps), options.MaxActiveRsvps, 1, 100_000);
                options.CookieLifetimeDays = ReadInt(section, nameof(RsvpOptions.CookieLifetimeDays), options.CookieLifetimeDays, 1, 400);
            });

        services.AddSingleton<RsvpSettings>();
        services.AddSingleton<IRsvpRepository, TableRsvpRepository>();
        services.AddSingleton<RsvpStatusCache>();
        return services;
    }

    private static int ReadInt(IConfigurationSection section, string key, int fallback, int min, int max) =>
        int.TryParse(section[key], NumberStyles.Integer, CultureInfo.InvariantCulture, out var value) && value >= min && value <= max
            ? value
            : fallback;
}
