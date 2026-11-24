using Microsoft.Extensions.DependencyInjection;

namespace WeddingPlanner.Api.Features.Admin.Matching;

/// <summary>Admin matching registrations, called from <c>Program.cs</c>.</summary>
public static class AdminMatchingFeatureServiceCollectionExtensions
{
    /// <summary>Empty stub wired by S0-03; S3-05 registers its services here.</summary>
    public static IServiceCollection AddAdminMatchingFeature(this IServiceCollection services) => services;
}
