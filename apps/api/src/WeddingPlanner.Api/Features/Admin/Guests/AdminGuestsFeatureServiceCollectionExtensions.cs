using Microsoft.Extensions.DependencyInjection;

namespace WeddingPlanner.Api.Features.Admin.Guests;

/// <summary>Admin guest list registrations, called from <c>Program.cs</c>.</summary>
public static class AdminGuestsFeatureServiceCollectionExtensions
{
    /// <summary>Empty stub wired by S0-03; S3-03 registers its services here.</summary>
    public static IServiceCollection AddAdminGuestsFeature(this IServiceCollection services) => services;
}
