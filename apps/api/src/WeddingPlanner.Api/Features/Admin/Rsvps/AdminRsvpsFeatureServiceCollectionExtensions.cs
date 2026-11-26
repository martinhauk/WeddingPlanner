using Microsoft.Extensions.DependencyInjection;

namespace WeddingPlanner.Api.Features.Admin.Rsvps;

/// <summary>Admin RSVP management registrations, called from <c>Program.cs</c>.</summary>
public static class AdminRsvpsFeatureServiceCollectionExtensions
{
    /// <summary>
    /// Nothing to register: <see cref="AdminRsvpsFunctions"/> uses the repository and settings that the storage and
    /// RSVP features register, and the worker activates function classes itself.
    /// </summary>
    public static IServiceCollection AddAdminRsvpsFeature(this IServiceCollection services) => services;
}
