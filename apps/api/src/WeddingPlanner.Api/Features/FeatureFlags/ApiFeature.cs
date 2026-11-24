namespace WeddingPlanner.Api.Features.FeatureFlags;

/// <summary>A guest- or admin-visible API feature that can be switched off per environment.</summary>
public enum ApiFeature
{
    /// <summary>Public RSVP endpoints (<c>Rsvp*</c> functions), app setting <c>Features__Rsvp</c>.</summary>
    Rsvp,

    /// <summary>Admin endpoints (<c>Admin*</c> functions), app setting <c>Features__Admin</c>.</summary>
    Admin,
}
