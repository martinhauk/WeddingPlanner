using Microsoft.AspNetCore.Http;

using WeddingPlanner.Api.Http;

namespace WeddingPlanner.Api.Features.Rsvp;

/// <summary>
/// The two RSVP cookies (architecture section 8), written only through <see cref="CookieWriter"/>:
/// <list type="bullet">
///   <item><c>wp_rsvp=&lt;rsvpId&gt;.&lt;token&gt;; Max-Age=…; Path=/api/rsvp; Secure; HttpOnly; SameSite=Strict</c>: the
///   credential, sent only to the RSVP API and invisible to scripts;</item>
///   <item><c>wp_rsvp_state=yes|no; Max-Age=…; Path=/; Secure; SameSite=Lax</c>: no personal data, readable by the
///   web app so it can show "answered" without calling the API.</item>
/// </list>
/// </summary>
public static class RsvpCookies
{
    /// <summary>Name of the credential cookie.</summary>
    public const string CredentialName = "wp_rsvp";

    /// <summary>Name of the state cookie.</summary>
    public const string StateName = "wp_rsvp_state";

    private static readonly CookieWriter _credential = new(CredentialName, "/api/rsvp", httpOnly: true, sameSite: SameSiteMode.Strict);
    private static readonly CookieWriter _state = new(StateName, "/", httpOnly: false, sameSite: SameSiteMode.Lax);

    /// <summary>Sets (or refreshes) both cookies.</summary>
    public static void Set(HttpResponse response, RsvpCredential credential, bool attending, TimeSpan lifetime)
    {
        ArgumentNullException.ThrowIfNull(response);
        ArgumentNullException.ThrowIfNull(credential);

        _credential.Set(response, credential.CookieValue, lifetime);
        _state.Set(response, attending ? "yes" : "no", lifetime);
    }

    /// <summary>Clears both cookies (<c>Max-Age=0</c>, same path and attributes).</summary>
    public static void Clear(HttpResponse response)
    {
        _credential.Clear(response);
        _state.Clear(response);
    }

    /// <summary>The raw credential cookie of the request, or <see langword="null"/>.</summary>
    public static string? ReadCredential(HttpRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        return request.Cookies.TryGetValue(CredentialName, out var value) ? value : null;
    }

    /// <summary>Whether the request carries either RSVP cookie.</summary>
    public static bool HasAny(HttpRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        return request.Cookies.ContainsKey(CredentialName) || request.Cookies.ContainsKey(StateName);
    }
}
