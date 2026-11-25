using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace WeddingPlanner.Api.Storage;

/// <summary>Table Storage registrations, called from <c>Program.cs</c>.</summary>
public static class StorageServiceCollectionExtensions
{
    /// <summary>
    /// Binds <see cref="StorageOptions"/> and registers the lazy <see cref="TableStorage"/>: no network at
    /// startup, and <c>/api/health</c> never resolves it.
    /// </summary>
    public static IServiceCollection AddStorage(this IServiceCollection services)
    {
        services.AddOptions<StorageOptions>()
            .Configure<IConfiguration>((options, configuration) =>
            {
                var section = configuration.GetSection(StorageOptions.SectionName);
                options.ConnectionString = section[nameof(StorageOptions.ConnectionString)]?.Trim();
                options.TablePrefix = section[nameof(StorageOptions.TablePrefix)]?.Trim() ?? string.Empty;
            });

        services.AddSingleton<TableStorage>();
        return services;
    }
}
