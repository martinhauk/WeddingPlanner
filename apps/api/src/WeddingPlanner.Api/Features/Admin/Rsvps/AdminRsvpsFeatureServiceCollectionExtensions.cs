using Microsoft.Extensions.DependencyInjection;

namespace WeddingPlanner.Api.Features.Admin.Rsvps;

/// <summary>Admin RSVP management registrations, called from <c>Program.cs</c>.</summary>
public static class AdminRsvpsFeatureServiceCollectionExtensions
{
    /// <summary>Empty stub wired by S0-03; S3-02 registers its services here.</summary>
    public static IServiceCollection AddAdminRsvpsFeature(this IServiceCollection services) => services;
}
