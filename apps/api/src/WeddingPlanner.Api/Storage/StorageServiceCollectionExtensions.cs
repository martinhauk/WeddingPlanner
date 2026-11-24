using Microsoft.Extensions.DependencyInjection;

namespace WeddingPlanner.Api.Storage;

/// <summary>Table Storage registrations, called from <c>Program.cs</c>.</summary>
public static class StorageServiceCollectionExtensions
{
    /// <summary>
    /// Empty stub wired by S0-03. S2-03 registers the lazy <c>TableServiceClient</c> from
    /// <c>Storage__ConnectionString</c> here: no network at startup, and <c>/api/health</c> never resolves it.
    /// </summary>
    public static IServiceCollection AddStorage(this IServiceCollection services) => services;
}
