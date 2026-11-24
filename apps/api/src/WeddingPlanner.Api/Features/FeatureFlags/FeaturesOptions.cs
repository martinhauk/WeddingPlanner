namespace WeddingPlanner.Api.Features.FeatureFlags;

/// <summary>
/// Per-environment feature flags, bound from the app settings <c>Features__Rsvp</c> and <c>Features__Admin</c>
/// (configuration section <c>Features</c>). The code default of every flag is <see langword="false"/>: a
/// feature ships dark until the deployment switches it on.
/// </summary>
public sealed class FeaturesOptions
{
    /// <summary>Configuration section that holds the flags.</summary>
    public const string SectionName = "Features";

    /// <summary>Public RSVP endpoints. Default: off.</summary>
    public bool Rsvp { get; set; }

    /// <summary>Admin endpoints. Default: off.</summary>
    public bool Admin { get; set; }

    /// <summary>Whether <paramref name="feature"/> is switched on.</summary>
    public bool IsEnabled(ApiFeature feature) => feature switch
    {
        ApiFeature.Rsvp => Rsvp,
        ApiFeature.Admin => Admin,
        _ => false,
    };
}
