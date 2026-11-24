using Microsoft.Extensions.DependencyInjection;

namespace WeddingPlanner.Api.Features.Admin.Settings;

/// <summary>Admin settings registrations, called from <c>Program.cs</c>.</summary>
public static class AdminSettingsFeatureServiceCollectionExtensions
{
    /// <summary>Empty stub wired by S0-03; S3-07 registers its services here.</summary>
    public static IServiceCollection AddAdminSettingsFeature(this IServiceCollection services) => services;
}
