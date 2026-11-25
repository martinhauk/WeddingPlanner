using System.Globalization;

using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

using WeddingPlanner.Api.Http;

namespace WeddingPlanner.Api.RateLimiting;

/// <summary>
/// Limits of <see cref="RateLimitingMiddleware"/>, bound from the <c>RateLimiting</c> section
/// (<c>RateLimiting__WritesPerClient</c>, …). Every value has a code default; a missing, malformed or
/// out-of-range value keeps the default.
/// </summary>
public sealed class RateLimitingOptions
{
    /// <summary>Configuration section.</summary>
    public const string SectionName = "RateLimiting";

    /// <summary>Writes (POST, PUT, PATCH, DELETE) one client may send per <see cref="WriteWindow"/>. Default 10.</summary>
    public int WritesPerClient { get; set; } = 10;

    /// <summary>Window of <see cref="WritesPerClient"/>. Default 10 minutes.</summary>
    public TimeSpan WriteWindow { get; set; } = TimeSpan.FromMinutes(10);

    /// <summary>Reads (GET) one client may send per <see cref="ReadWindow"/>. Default 60.</summary>
    public int ReadsPerClient { get; set; } = 60;

    /// <summary>Window of <see cref="ReadsPerClient"/>. Default 1 minute.</summary>
    public TimeSpan ReadWindow { get; set; } = TimeSpan.FromMinutes(1);

    /// <summary>
    /// Writes one worker instance accepts per minute from all clients together: the backstop when client
    /// keys are spoofed or rotated. Default 120.
    /// </summary>
    public int InstanceWritesPerMinute { get; set; } = 120;

    /// <summary>Single-address header read first for the client key. Default <c>x-azure-clientip</c>; empty skips it.</summary>
    public string ClientIpHeader { get; set; } = ClientAddress.DefaultHeaderName;
}

/// <summary>Registers <see cref="RateLimitingOptions"/>.</summary>
public static class RateLimitingServiceCollectionExtensions
{
    /// <summary>Binds <see cref="RateLimitingOptions"/> leniently (no I/O; malformed values keep their default).</summary>
    public static IServiceCollection AddRateLimiting(this IServiceCollection services)
    {
        services.AddOptions<RateLimitingOptions>()
            .Configure<IConfiguration>((options, configuration) =>
            {
                var section = configuration.GetSection(RateLimitingOptions.SectionName);
                options.WritesPerClient = ReadInt(section, nameof(RateLimitingOptions.WritesPerClient), options.WritesPerClient, 1, 10_000);
                options.ReadsPerClient = ReadInt(section, nameof(RateLimitingOptions.ReadsPerClient), options.ReadsPerClient, 1, 100_000);
                options.InstanceWritesPerMinute = ReadInt(
                    section, nameof(RateLimitingOptions.InstanceWritesPerMinute), options.InstanceWritesPerMinute, 1, 100_000);
                options.WriteWindow = TimeSpan.FromSeconds(ReadInt(section, "WriteWindowSeconds", (int)options.WriteWindow.TotalSeconds, 1, 86_400));
                options.ReadWindow = TimeSpan.FromSeconds(ReadInt(section, "ReadWindowSeconds", (int)options.ReadWindow.TotalSeconds, 1, 86_400));
                if (section[nameof(RateLimitingOptions.ClientIpHeader)] is { } header)
                {
                    options.ClientIpHeader = header.Trim();
                }
            });

        return services;
    }

    private static int ReadInt(IConfigurationSection section, string key, int fallback, int min, int max) =>
        int.TryParse(section[key], NumberStyles.Integer, CultureInfo.InvariantCulture, out var value) && value >= min && value <= max
            ? value
            : fallback;
}
