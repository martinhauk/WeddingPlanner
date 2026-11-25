using System.Net;
using System.Net.Sockets;

using Microsoft.AspNetCore.Http;

namespace WeddingPlanner.Api.Http;

/// <summary>
/// Derives a rate-limit key for the client of a request. The address is used in memory only: never logged,
/// stored or returned.
/// </summary>
/// <remarks>
/// Sources, first match wins: the configured single-address header (default <c>X-Azure-ClientIP</c>, one of the
/// headers the platform probe reports), then the first <c>X-Forwarded-For</c> entry (port removed), then the
/// connection address. IPv6 addresses are reduced to their /64 prefix, because one client usually controls a
/// whole /64. Which header the Static Web Apps proxy sets, and whether it overwrites a client-sent value, is
/// measured with the probe (<c>scripts/smoke/api-probe.sh</c>); the per-instance write limit covers spoofed keys.
/// </remarks>
public static class ClientAddress
{
    /// <summary>The header read first unless <c>RateLimiting__ClientIpHeader</c> names another one.</summary>
    public const string DefaultHeaderName = "x-azure-clientip";

    /// <summary>Key used when no address can be determined (all such requests share one bucket).</summary>
    public const string UnknownKey = "unknown";

    /// <summary>Returns the rate-limit key of <paramref name="request"/>.</summary>
    /// <param name="request">The request.</param>
    /// <param name="headerName">Single-address header to read first; empty to skip it.</param>
    public static string ResolveKey(HttpRequest request, string? headerName = DefaultHeaderName)
    {
        ArgumentNullException.ThrowIfNull(request);

        if (!string.IsNullOrWhiteSpace(headerName) && TryParse(request.Headers[headerName].ToString(), out var fromHeader))
        {
            return ToKey(fromHeader);
        }

        var forwardedFor = request.Headers["x-forwarded-for"].ToString();
        var firstEntry = forwardedFor.Split(',', 2)[0];
        if (TryParse(firstEntry, out var fromForwardedFor))
        {
            return ToKey(fromForwardedFor);
        }

        return request.HttpContext.Connection.RemoteIpAddress is { } remote ? ToKey(remote) : UnknownKey;
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
