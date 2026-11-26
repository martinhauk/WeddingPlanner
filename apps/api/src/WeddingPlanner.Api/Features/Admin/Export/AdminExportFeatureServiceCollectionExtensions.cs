using Microsoft.Extensions.DependencyInjection;

namespace WeddingPlanner.Api.Features.Admin.Export;

/// <summary>Admin CSV export registrations, called from <c>Program.cs</c>.</summary>
public static class AdminExportFeatureServiceCollectionExtensions
{
    /// <summary>
    /// Nothing to register: <see cref="AdminExportFunction"/> uses the repository and settings that the storage and
    /// RSVP features register, and the worker activates function classes itself.
    /// </summary>
    public static IServiceCollection AddAdminExportFeature(this IServiceCollection services) => services;
}
