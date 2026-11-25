using System.Net;

using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Primitives;

using WeddingPlanner.Api.Http;
using WeddingPlanner.Api.Pipeline;

namespace WeddingPlanner.Api.Features.Health;

/// <summary>
/// <c>GET /api/health/probe</c>: a temporary, switchable platform probe for two undocumented Static Web Apps
/// behaviours. It echoes the caller's own forwarding headers (which header carries the client IP, and at which
/// <c>X-Forwarded-For</c> position) and sets the <c>wp_probe</c> cookie so a second call shows whether the cookie
/// survives the proxy in both directions (<c>scripts/smoke/api-probe.sh</c> runs the round trip).
/// </summary>
/// <remarks>
/// Anonymous, never feature-gated, no I/O, <c>Cache-Control: no-store</c>. The values are only echoed to the
/// caller: never logged or stored. Switched off with the app setting <c>Diagnostics__ProbeEnabled=false</c> once
/// the findings are recorded (S0-12); it then answers 404 like a disabled feature.
/// <para>
/// The worker sees the request after the Functions host has proxied it, and the forwarded-headers handling of the
/// ASP.NET Core integration may already have consumed the last <c>X-Forwarded-For</c> entry: it then moves that
/// entry into the connection address and keeps the previous connection address in <c>X-Original-For</c>. The
/// probe therefore reports the connection address and <c>X-Original-*</c> headers as well.
/// </para>
/// </remarks>
public sealed class ProbeFunction(IConfiguration configuration)
{
    /// <summary>Function name (no <c>Rsvp</c>/<c>Admin</c> prefix, so the feature gate never applies).</summary>
    public const string FunctionName = "HealthProbe";

    /// <summary>Configuration key of the app setting <c>Diagnostics__ProbeEnabled</c>.</summary>
    public const string EnabledSettingKey = "Diagnostics:ProbeEnabled";

    /// <summary>Code default of <see cref="EnabledSettingKey"/>: on until the measurement is recorded.</summary>
    public const bool EnabledByDefault = true;

    /// <summary>Name of the probe cookie.</summary>
    public const string CookieName = "wp_probe";

    /// <summary>Value of the probe cookie.</summary>
    public const string CookieValue = "1";

    /// <summary>Request header Static Web Apps sets for a signed-in user.</summary>
    public const string ClientPrincipalHeaderName = "x-ms-client-principal";

    /// <summary>Location name of the worker's connection address in <see cref="ProbeResponse.AddressMatches"/>.</summary>
    public const string RemoteAddressLocation = "remote-address";

    /// <summary>Lifetime of the probe cookie: long enough for the second request of the round trip.</summary>
    public static readonly TimeSpan CookieLifetime = TimeSpan.FromSeconds(60);

    /// <summary>
    /// Forwarding headers echoed with their values, in this order, when present: standard, ASP.NET Core
    /// forwarded-headers, Azure Front Door, App Service and common proxy headers that may carry the client address
    /// or the original host.
    /// </summary>
    public static readonly IReadOnlyList<string> ForwardingHeaderNames =
    [
        "forwarded",
        "x-forwarded-for",
        "x-forwarded-host",
        "x-forwarded-proto",
        "x-forwarded-port",
        "x-original-for",
        "x-original-host",
        "x-original-proto",
        "disguised-host",
        "x-azure-clientip",
        "x-azure-socketip",
        "x-client-ip",
        "x-client-port",
        "client-ip",
        "x-real-ip",
        "true-client-ip",
    ];

    /// <summary>Headers that carry a comma-separated list of addresses (one entry per hop).</summary>
    public static readonly IReadOnlyList<string> AddressListHeaderNames = ["x-forwarded-for", "x-original-for"];

    /// <summary>Headers that carry a single address.</summary>
    public static readonly IReadOnlyList<string> SingleAddressHeaderNames =
    [
        "x-azure-clientip",
        "x-azure-socketip",
        "x-client-ip",
        "client-ip",
        "x-real-ip",
        "true-client-ip",
    ];

    // Path=/api/health also covers /api/health/probe, so the cookie travels back on the second request.
    private static readonly CookieWriter _probeCookie = new(CookieName, "/api/health");

    [Function(FunctionName)]
    public IActionResult Run(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = "health/probe")] HttpRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);

        var response = request.HttpContext.Response;
        response.Headers.CacheControl = "no-store";

        if (!IsEnabled(configuration[EnabledSettingKey]))
        {
            return NotFound();
        }

        _probeCookie.Set(response, CookieValue, CookieLifetime);
        return new OkObjectResult(Measure(request));
    }

    /// <summary>
    /// Reads <c>Diagnostics__ProbeEnabled</c>: missing or empty means <see cref="EnabledByDefault"/>, a boolean
    /// is taken as is, and a malformed value switches the probe off (fail closed).
    /// </summary>
    internal static bool IsEnabled(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return EnabledByDefault;
        }

        return bool.TryParse(value.Trim(), out var enabled) && enabled;
    }

    /// <summary>Builds the probe body from the request. Pure: no I/O, no logging.</summary>
    internal static ProbeResponse Measure(HttpRequest request)
    {
        var headers = request.Headers;

        var forwardingHeaders = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var name in ForwardingHeaderNames)
        {
            if (headers.TryGetValue(name, out var values) && !StringValues.IsNullOrEmpty(values))
            {
                forwardingHeaders[name] = string.Join(", ", values.ToArray());
            }
        }

        var remoteAddress = request.HttpContext.Connection.RemoteIpAddress is { } remote ? Normalize(remote) : null;

        // Every place an address was seen: list entries as "name[position]", single addresses by name.
        var locations = new List<(string Location, string Address)>();
        var xffHopCount = 0;
        foreach (var name in AddressListHeaderNames)
        {
            var entries = SplitEntries(headers[name]);
            if (name == "x-forwarded-for")
            {
                xffHopCount = entries.Count;
            }

            locations.AddRange(entries.Select((entry, position) => ($"{name}[{position}]", NormalizeAddress(entry))));
        }

        var singleAddresses = SingleAddressHeaderNames
            .Where(forwardingHeaders.ContainsKey)
            .Select(name => (Location: name, Address: NormalizeAddress(forwardingHeaders[name])))
            .ToList();
        if (remoteAddress is not null)
        {
            singleAddresses.Add((RemoteAddressLocation, remoteAddress));
        }

        locations.AddRange(singleAddresses);

        var addressMatches = new Dictionary<string, IReadOnlyList<string>>(StringComparer.Ordinal);
        foreach (var (location, address) in singleAddresses)
        {
            addressMatches[location] = locations
                .Where(other => other.Location != location && string.Equals(other.Address, address, StringComparison.OrdinalIgnoreCase))
                .Select(other => other.Location)
                .ToList();
        }

        var requestHeaderNames = headers.Keys
            .Select(name => name.ToLowerInvariant())
            .Distinct(StringComparer.Ordinal)
            .Order(StringComparer.Ordinal)
            .ToList();

        return new ProbeResponse(
            forwardingHeaders,
            remoteAddress,
            xffHopCount,
            addressMatches,
            requestHeaderNames,
            CookieReceived: request.Cookies.TryGetValue(CookieName, out var cookie) && cookie == CookieValue,
            HasClientPrincipal: !StringValues.IsNullOrEmpty(headers[ClientPrincipalHeaderName]));
    }

    /// <summary>
    /// Normalises an address for comparison: drops a port and IPv6 brackets and maps IPv4-mapped IPv6 to IPv4
    /// (<c>203.0.113.7:51234</c> → <c>203.0.113.7</c>). Anything that is not an address is only trimmed.
    /// </summary>
    internal static string NormalizeAddress(string value)
    {
        var trimmed = value.Trim();
        return IPEndPoint.TryParse(trimmed, out var endPoint) ? Normalize(endPoint.Address) : trimmed;
    }

    private static string Normalize(IPAddress address) =>
        (address.IsIPv4MappedToIPv6 ? address.MapToIPv4() : address).ToString();

    private static List<string> SplitEntries(StringValues values) => values
        .SelectMany(value => (value ?? string.Empty).Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries))
        .ToList();

    private static ObjectResult NotFound() => new(new ProblemDetails
    {
        Type = "https://tools.ietf.org/html/rfc9110#section-15.5.5",
        Title = "Not Found",
        Status = StatusCodes.Status404NotFound,
        Extensions = { ["code"] = "not_found" },
    })
    {
        StatusCode = StatusCodes.Status404NotFound,
        ContentTypes = { FeatureGateMiddleware.ProblemJsonContentType },
    };
}

/// <summary>Body of <c>GET /api/health/probe</c>. Echoed to the caller only; never logged or stored.</summary>
/// <param name="ForwardingHeaders">
/// The caller's own forwarding headers (<see cref="ProbeFunction.ForwardingHeaderNames"/>) that are present, by
/// lower-case name, with their values (repeated headers joined with <c>", "</c>).
/// </param>
/// <param name="RemoteAddress">The connection address the worker sees (normalised), or <see langword="null"/>.</param>
/// <param name="XffHopCount">
/// Number of non-empty <c>X-Forwarded-For</c> entries the worker sees (0 without the header).
/// </param>
/// <param name="AddressMatches">
/// For each present single-address header (<see cref="ProbeFunction.SingleAddressHeaderNames"/>) and the
/// <c>remote-address</c>: every other location holding the same address, ports ignored, such as
/// <c>x-forwarded-for[0]</c> (zero-based position), <c>x-original-for[1]</c>, <c>x-client-ip</c> or
/// <c>remote-address</c>. Names and positions only, so the findings can be recorded without any address.
/// </param>
/// <param name="RequestHeaderNames">Every request header name, lower case and sorted, without values.</param>
/// <param name="CookieReceived">Whether the request carried <c>wp_probe=1</c>.</param>
/// <param name="HasClientPrincipal">Whether the request carried a non-empty <c>x-ms-client-principal</c>.</param>
public sealed record ProbeResponse(
    IReadOnlyDictionary<string, string> ForwardingHeaders,
    string? RemoteAddress,
    int XffHopCount,
    IReadOnlyDictionary<string, IReadOnlyList<string>> AddressMatches,
    IReadOnlyList<string> RequestHeaderNames,
    bool CookieReceived,
    bool HasClientPrincipal);
