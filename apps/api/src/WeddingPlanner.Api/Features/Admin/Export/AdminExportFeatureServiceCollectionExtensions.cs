using Microsoft.Extensions.DependencyInjection;

namespace WeddingPlanner.Api.Features.Admin.Export;

/// <summary>Admin CSV export registrations, called from <c>Program.cs</c>.</summary>
public static class AdminExportFeatureServiceCollectionExtensions
{
    /// <summary>Empty stub wired by S0-03; S3-06 registers its services here.</summary>
    public static IServiceCollection AddAdminExportFeature(this IServiceCollection services) => services;
}
