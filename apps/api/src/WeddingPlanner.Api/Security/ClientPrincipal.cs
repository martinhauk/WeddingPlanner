using System.Diagnostics.CodeAnalysis;
using System.Text.Json;

namespace WeddingPlanner.Api.Security;

/// <summary>
/// The signed-in user as Azure Static Web Apps forwards it to the API: the <c>x-ms-client-principal</c> header holds
/// base64-encoded JSON <c>{identityProvider, userId, userDetails, userRoles, claims}</c>. Only the provider and the
/// roles are kept; <c>userDetails</c> (an e-mail address or user name) is never read.
/// </summary>
/// <param name="IdentityProvider">The login provider, for example <c>aad</c>.</param>
/// <param name="UserRoles">The user's roles, for example <c>anonymous</c>, <c>authenticated</c>, <c>admin</c>.</param>
public sealed record ClientPrincipal(string IdentityProvider, IReadOnlyList<string> UserRoles)
{
    /// <summary>The header SWA sets for signed-in users (absent for anonymous requests).</summary>
    public const string HeaderName = "x-ms-client-principal";

    /// <summary>The only role that may use the admin API.</summary>
    public const string AdminRole = "admin";

    /// <summary>The only login provider admins may use (the preconfigured Microsoft provider).</summary>
    public const string AdminIdentityProvider = "aad";

    /// <summary>Longer headers are refused unread (SWA principals are well below 4 KB).</summary>
    public const int MaxHeaderLength = 16 * 1024;

    private static readonly JsonDocumentOptions _jsonOptions = new() { MaxDepth = 8 };

    /// <summary>Whether this user may use the admin API: role <c>admin</c> and provider <c>aad</c>.</summary>
    public bool IsAdmin =>
        string.Equals(IdentityProvider, AdminIdentityProvider, StringComparison.OrdinalIgnoreCase)
        && UserRoles.Contains(AdminRole, StringComparer.OrdinalIgnoreCase);

    /// <summary>
    /// Decodes the header value. Returns <see langword="false"/> when it is missing, too long, not base64, not a JSON
    /// object or has no <c>identityProvider</c>; such a request counts as not signed in.
    /// </summary>
    public static bool TryParse(string? headerValue, [NotNullWhen(true)] out ClientPrincipal? principal)
    {
        principal = null;
        if (string.IsNullOrWhiteSpace(headerValue) || headerValue.Length > MaxHeaderLength)
        {
            return false;
        }

        var bytes = new byte[headerValue.Length];
        if (!Convert.TryFromBase64String(headerValue.Trim(), bytes, out var length))
        {
            return false;
        }

        try
        {
            using var document = JsonDocument.Parse(bytes.AsMemory(0, length), _jsonOptions);
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object
                || !root.TryGetProperty("identityProvider", out var provider)
                || provider.ValueKind != JsonValueKind.String
                || provider.GetString() is not { Length: > 0 } identityProvider)
            {
                return false;
            }

            var roles = new List<string>();
            if (root.TryGetProperty("userRoles", out var userRoles) && userRoles.ValueKind == JsonValueKind.Array)
            {
                roles.AddRange(userRoles.EnumerateArray()
                    .Where(role => role.ValueKind == JsonValueKind.String)
                    .Select(role => role.GetString() ?? string.Empty));
            }

            principal = new ClientPrincipal(identityProvider, roles);
            return true;
        }
        catch (JsonException)
        {
            return false;
        }
    }
}
