using System.Net;
using System.Net.Sockets;

using Microsoft.AspNetCore.Http;

namespace WeddingPlanner.Api.Http;

/// <summary>
/// Derives a rate-limit key for the client of a request. The address is used in memory only: never logged,
/// stored or returned.
/// </summary>
/// <remarks>
/// The only source is the single-address header named by <c>RateLimiting__ClientIpHeader</c>, and only when it
/// names one: the code default is empty, so no request has a per-client key. Measured on the Static Web Apps
/// managed API (ADR 0011, <c>scripts/smoke/api-probe.sh</c>), no request header carries the caller's address:
/// <list type="bullet">
///   <item><c>X-Azure-ClientIP</c>, <c>X-Client-IP</c>, <c>X-Real-IP</c>, <c>True-Client-IP</c> and
///   <c>X-Azure-SocketIP</c> are absent unless the caller sends them, and then pass through unchanged (spoofable);</item>
///   <item><c>X-Forwarded-For</c> never reaches the worker (a client-sent one is dropped), and the connection
///   address it turns into is one platform address shared by every caller (it would pool all guests into one
///   bucket);</item>
///   <item><c>Client-IP</c> is set by the platform (a client value is replaced) but holds a proxy address that
///   changes from request to request.</item>
/// </list>
/// So neither <c>X-Forwarded-For</c> (its first entry is whatever the caller sent) nor the connection address is
/// ever read. Configure the header only behind a proxy that overwrites it with the caller's address; IPv6 is then
/// reduced to its /64 prefix, because one client usually controls a whole /64. Without a key a request skips the
/// per-client limits and only the per-instance write backstop applies.
/// </remarks>
public static class ClientAddress
{
    /// <summary>
    /// Returns the rate-limit key of <paramref name="request"/>, or <see langword="null"/> when
    /// <paramref name="headerName"/> is empty or its header holds no single address (the request then has no
    /// per-client key).
    /// </summary>
    /// <param name="request">The request.</param>
    /// <param name="headerName">
    /// The trusted single-address header (<c>RateLimiting__ClientIpHeader</c>); empty or <see langword="null"/>
    /// trusts none.
    /// </param>
    public static string? ResolveKey(HttpRequest request, string? headerName)
    {
        ArgumentNullException.ThrowIfNull(request);

        if (string.IsNullOrWhiteSpace(headerName))
        {
            return null;
        }

        // A list ("a, b") or a repeated header does not parse as one address: no key rather than a guess.
        return TryParse(request.Headers[headerName].ToString(), out var address) ? ToKey(address) : null;
    }

    /// <summary>Parses an address with or without port (<c>203.0.113.7:51234</c>, <c>[2001:db8::1]:443</c>).</summary>
    internal static bool TryParse(string? value, out IPAddress address)
    {
        address = IPAddress.None;
        var trimmed = value?.Trim();
        if (string.IsNullOrEmpty(trimmed))
        {
            return false;
        }

        // IPEndPoint accepts an address with or without port, IPv6 with or without brackets.
        if (!IPEndPoint.TryParse(trimmed, out var endPoint))
        {
            return false;
        }

        address = endPoint.Address;
        return true;
    }

    /// <summary>IPv4 as is (IPv4-mapped IPv6 unwrapped); IPv6 as its /64 network.</summary>
    internal static string ToKey(IPAddress address)
    {
        if (address.IsIPv4MappedToIPv6)
        {
            address = address.MapToIPv4();
        }

        if (address.AddressFamily != AddressFamily.InterNetworkV6)
        {
            return address.ToString();
        }

        var bytes = address.GetAddressBytes();
        Array.Clear(bytes, 8, 8);
        return $"{new IPAddress(bytes)}/64";
    }
}
