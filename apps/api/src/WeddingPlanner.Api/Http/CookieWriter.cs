using System.Globalization;

using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Primitives;

namespace WeddingPlanner.Api.Http;

/// <summary>
/// The only way the API sets or clears a cookie. One instance describes one cookie (name, path, HttpOnly,
/// SameSite); features keep it in a <see langword="static readonly"/> field and call <see cref="Set"/> or
/// <see cref="Clear"/>. Never use <c>Response.Cookies</c> or write <c>Set-Cookie</c> headers directly: a test
/// fails if any other source file does.
/// </summary>
/// <remarks>
/// The Static Web Apps proxy is known to drop cookies with a past <c>Expires</c> or a very long lifetime, so
/// every cookie written here:
/// <list type="bullet">
///   <item>carries <c>Max-Age</c> only (at most <see cref="MaxLifetime"/>), never <c>Expires</c>;</item>
///   <item>never carries <c>Domain</c> (host-only cookies);</item>
///   <item>is always <c>Secure</c>, with <c>SameSite</c> <c>Strict</c> or <c>Lax</c>;</item>
///   <item>is cleared with <c>Max-Age=0</c> and the same path and attributes, never with
///   <c>Cookies.Delete()</c> (which writes a past <c>Expires</c>).</item>
/// </list>
/// The format is fixed: <c>name=value; Max-Age=seconds; Path=path; Secure[; HttpOnly]; SameSite=Strict|Lax</c>.
/// Values are written verbatim, so they are restricted to RFC 6265 cookie octets without <c>%</c>: ASP.NET Core
/// URL-unescapes request cookies, and a value without <c>%</c> reads back unchanged. Use URL-safe tokens
/// (for example base64url).
/// </remarks>
public sealed class CookieWriter
{
    /// <summary>Longest lifetime a cookie may have (browsers cap <c>Max-Age</c> at 400 days anyway).</summary>
    public static readonly TimeSpan MaxLifetime = TimeSpan.FromDays(400);

    // RFC 6265 cookie-name is an RFC 2616 token: no CTLs, no whitespace and none of these separators.
    private const string NameSeparators = "()<>@,;:\\\"/[]?={}";

    /// <summary>Describes one cookie. Invalid names, paths or SameSite modes throw immediately.</summary>
    /// <param name="name">Cookie name (an RFC 2616 token, for example <c>wp_rsvp</c>).</param>
    /// <param name="path">Absolute path the browser sends the cookie to, for example <c>/api/rsvp</c>.</param>
    /// <param name="httpOnly">Hide the cookie from JavaScript. Default: <see langword="true"/>.</param>
    /// <param name="sameSite"><see cref="SameSiteMode.Strict"/> (default) or <see cref="SameSiteMode.Lax"/>.</param>
    public CookieWriter(string name, string path, bool httpOnly = true, SameSiteMode sameSite = SameSiteMode.Strict)
    {
        ArgumentException.ThrowIfNullOrEmpty(name);
        ArgumentException.ThrowIfNullOrEmpty(path);

        if (!name.All(IsTokenChar))
        {
            throw new ArgumentException("A cookie name must be an RFC 2616 token.", nameof(name));
        }

        if (path[0] != '/' || !path.All(IsPathChar))
        {
            throw new ArgumentException("A cookie path must start with '/' and contain no whitespace, control characters or ';'.", nameof(path));
        }

        if (sameSite is not (SameSiteMode.Strict or SameSiteMode.Lax))
        {
            throw new ArgumentOutOfRangeException(nameof(sameSite), sameSite, "Only SameSite=Strict or SameSite=Lax is allowed.");
        }

        Name = name;
        Path = path;
        HttpOnly = httpOnly;
        SameSite = sameSite;
    }

    /// <summary>The cookie name.</summary>
    public string Name { get; }

    /// <summary>The cookie path.</summary>
    public string Path { get; }

    /// <summary>Whether the cookie is hidden from JavaScript.</summary>
    public bool HttpOnly { get; }

    /// <summary><see cref="SameSiteMode.Strict"/> or <see cref="SameSiteMode.Lax"/>.</summary>
    public SameSiteMode SameSite { get; }

    /// <summary>Appends a <c>Set-Cookie</c> header that stores <paramref name="value"/> for <paramref name="maxAge"/>.</summary>
    /// <param name="response">The response to add the header to (before it has started).</param>
    /// <param name="value">Non-empty RFC 6265 cookie octets without <c>%</c>.</param>
    /// <param name="maxAge">Whole seconds, at least one second and at most <see cref="MaxLifetime"/>.</param>
    public void Set(HttpResponse response, string value, TimeSpan maxAge)
    {
        ArgumentNullException.ThrowIfNull(response);
        ArgumentException.ThrowIfNullOrEmpty(value);

        if (!value.All(IsValueChar))
        {
            throw new ArgumentException("A cookie value must consist of RFC 6265 cookie octets other than '%'.", nameof(value));
        }

        if (maxAge < TimeSpan.FromSeconds(1) || maxAge > MaxLifetime || maxAge.Ticks % TimeSpan.TicksPerSecond != 0)
        {
            throw new ArgumentOutOfRangeException(nameof(maxAge), maxAge, "Max-Age must be whole seconds between 1 second and 400 days.");
        }

        Append(response, value, (long)maxAge.TotalSeconds);
    }

    /// <summary>
    /// Appends a <c>Set-Cookie</c> header that removes the cookie: empty value, <c>Max-Age=0</c>, same path and
    /// attributes. Never <c>Cookies.Delete()</c>, which writes a past <c>Expires</c> the proxy may drop.
    /// </summary>
    public void Clear(HttpResponse response)
    {
        ArgumentNullException.ThrowIfNull(response);
        Append(response, value: string.Empty, maxAgeSeconds: 0);
    }

    private void Append(HttpResponse response, string value, long maxAgeSeconds)
    {
        var header = string.Concat(
            Name,
            "=",
            value,
            "; Max-Age=",
            maxAgeSeconds.ToString(CultureInfo.InvariantCulture),
            "; Path=",
            Path,
            "; Secure",
            HttpOnly ? "; HttpOnly" : string.Empty,
            SameSite == SameSiteMode.Strict ? "; SameSite=Strict" : "; SameSite=Lax");

        response.Headers.SetCookie = StringValues.Concat(response.Headers.SetCookie, header);
    }

    private static bool IsTokenChar(char c) => c is > ' ' and < '\u007f' && !NameSeparators.Contains(c, StringComparison.Ordinal);

    private static bool IsPathChar(char c) => c is > ' ' and < '\u007f' and not ';';

    // cookie-octet = %x21 / %x23-2B / %x2D-3A / %x3C-5B / %x5D-7E (no space, DQUOTE, comma, semicolon or
    // backslash), additionally without '%' so the value reads back unchanged.
    private static bool IsValueChar(char c) => c is > ' ' and < '\u007f' and not ('"' or ',' or ';' or '\\' or '%');
}
