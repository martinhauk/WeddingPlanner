using Microsoft.Extensions.DependencyInjection;

namespace WeddingPlanner.Api.Features.Rsvp;

/// <summary>Public RSVP feature registrations, called from <c>Program.cs</c>.</summary>
public static class RsvpFeatureServiceCollectionExtensions
{
    /// <summary>Empty stub wired by S0-03; the RSVP tasks (S2-07, S2-08) register their services here.</summary>
    public static IServiceCollection AddRsvpFeature(this IServiceCollection services) => services;
}
