using System.Buffers.Text;
using System.Diagnostics.CodeAnalysis;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace WeddingPlanner.Api.Features.Rsvp;

/// <summary>
/// The secret that lets a browser read, change and delete its own reply: <c>&lt;rsvpId&gt;.&lt;token&gt;</c>, the value
/// of the <c>wp_rsvp</c> cookie and of the personal edit link (<c>/#edit=&lt;rsvpId&gt;.&lt;token&gt;</c>). The id is 16
/// random bytes as lower-case hex; the token is 32 random bytes (256 bits) as base64url. Only the SHA-256 hash of the
/// token is stored, and it is compared in constant time.
/// </summary>
public sealed partial class RsvpCredential
{
    private RsvpCredential(string rsvpId, string token)
    {
        RsvpId = rsvpId;
        Token = token;
    }

    /// <summary>
    /// A random hash no token matches (in practice): compared against when a reply id is unknown, so a lookup does the
    /// same hashing work whether or not the id exists.
    /// </summary>
    public static string DecoyHash { get; } = Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(SHA256.HashSizeInBytes));

    /// <summary>The reply id (row key).</summary>
    public string RsvpId { get; }

    /// <summary>
    /// The cookie value <c>&lt;rsvpId&gt;.&lt;token&gt;</c>, which is also the edit token of the personal edit link.
    /// </summary>
    public string CookieValue => $"{RsvpId}.{Token}";

    /// <summary>Lower-case hex SHA-256 of the token: the only form in which the token is stored.</summary>
    public string TokenHash => Convert.ToHexStringLower(HashToken());

    private string Token { get; }

    /// <summary>Creates a credential for a new reply from a cryptographic random number generator.</summary>
    public static RsvpCredential CreateNew() => new(
        Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(16)),
        Base64Url.EncodeToString(RandomNumberGenerator.GetBytes(32)));

    /// <summary>Parses a cookie value; anything but the exact format fails.</summary>
    public static bool TryParse(string? value, [NotNullWhen(true)] out RsvpCredential? credential)
    {
        credential = null;
        if (value is null || value.Length > 128)
        {
            return false;
        }

        var match = CookieFormat().Match(value);
        if (!match.Success)
        {
            return false;
        }

        credential = new RsvpCredential(match.Groups["id"].Value, match.Groups["token"].Value);
        return true;
    }

    /// <summary>Whether the token hashes to <paramref name="storedHash"/> (constant-time comparison).</summary>
    public bool MatchesHash(string? storedHash)
    {
        if (storedHash is null || storedHash.Length != SHA256.HashSizeInBytes * 2)
        {
            return false;
        }

        byte[] expected;
        try
        {
            expected = Convert.FromHexString(storedHash);
        }
        catch (FormatException)
        {
            return false;
        }

        return CryptographicOperations.FixedTimeEquals(HashToken(), expected);
    }

    /// <summary>Never prints the token.</summary>
    public override string ToString() => nameof(RsvpCredential);

    private byte[] HashToken() => SHA256.HashData(Encoding.ASCII.GetBytes(Token));

    [GeneratedRegex("^(?<id>[0-9a-f]{32})\\.(?<token>[A-Za-z0-9_-]{43})$", RegexOptions.CultureInvariant)]
    private static partial Regex CookieFormat();
}
