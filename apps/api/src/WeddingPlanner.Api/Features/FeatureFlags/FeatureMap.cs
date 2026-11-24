namespace WeddingPlanner.Api.Features.FeatureFlags;

/// <summary>
/// Maps Functions to features by the prefix of their function name: <c>Rsvp*</c> → <see cref="ApiFeature.Rsvp"/>,
/// <c>Admin*</c> → <see cref="ApiFeature.Admin"/>. Every other function (<c>Health</c>, <c>HealthProbe</c>, …) is
/// never gated. Matching ignores case, so a mis-cased name is gated rather than accidentally left open.
/// </summary>
public static class FeatureMap
{
    /// <summary>Function-name prefix of the public RSVP functions.</summary>
    public const string RsvpPrefix = "Rsvp";

    /// <summary>Function-name prefix of the admin functions (also selects the admin authorization middleware).</summary>
    public const string AdminPrefix = "Admin";

    /// <summary>Returns the feature a function belongs to, or <see langword="null"/> when it is never gated.</summary>
    public static ApiFeature? ForFunction(string functionName)
    {
        ArgumentNullException.ThrowIfNull(functionName);

        if (functionName.StartsWith(RsvpPrefix, StringComparison.OrdinalIgnoreCase))
        {
            return ApiFeature.Rsvp;
        }

        if (IsAdminFunction(functionName))
        {
            return ApiFeature.Admin;
        }

        return null;
    }

    /// <summary>True for <c>Admin*</c> functions: they are gated by <c>Features__Admin</c> and require an admin.</summary>
    public static bool IsAdminFunction(string functionName)
    {
        ArgumentNullException.ThrowIfNull(functionName);
        return functionName.StartsWith(AdminPrefix, StringComparison.OrdinalIgnoreCase);
    }
}
