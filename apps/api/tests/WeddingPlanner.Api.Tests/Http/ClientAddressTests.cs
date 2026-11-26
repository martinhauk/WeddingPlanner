using System.Net;

using Microsoft.AspNetCore.Http;

using Shouldly;

using WeddingPlanner.Api.Http;
using WeddingPlanner.Api.RateLimiting;

using Xunit;

namespace WeddingPlanner.Api.Tests.Http;

/// <summary>Documentation addresses only (RFC 5737, RFC 3849).</summary>
public sealed class ClientAddressTests
{
    private const string TrustedHeader = "x-trusted-client-ip";

    /// <summary>
    /// What the Static Web Apps managed API showed the worker (ADR 0011) for a caller that spoofs every forwarding
    /// header: the single-address headers pass the client value through, <c>X-Forwarded-For</c> is gone,
    /// <c>Client-IP</c> holds a changing proxy address with port, and the connection address is one platform
    /// address shared by every caller.
    /// </summary>
    private static readonly Dictionary<string, string> _measuredPlatformRequest = new()
    {
        ["X-Azure-ClientIP"] = "203.0.113.66",
        ["X-Azure-SocketIP"] = "203.0.113.66",
        ["X-Client-IP"] = "203.0.113.66",
        ["X-Real-IP"] = "203.0.113.66",
        ["True-Client-IP"] = "203.0.113.66",
        ["Client-IP"] = "198.51.100.23:50123",
        ["X-Original-For"] = "198.51.100.200:41000",
    };

    [Fact]
    public void TrustsNoHeaderByCodeDefault()
    {
        new RateLimitingOptions().ClientIpHeader.ShouldBeEmpty();
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData(" ")]
    public void WithoutATrustedHeaderTheMeasuredPlatformRequestHasNoKey(string? headerName)
    {
        var request = Request(_measuredPlatformRequest, IPAddress.Parse("198.51.100.1"));

        ClientAddress.ResolveKey(request, headerName).ShouldBeNull();
    }

    [Theory]
    [InlineData("X-Forwarded-For", "203.0.113.7")]
    [InlineData("X-Forwarded-For", "203.0.113.7, 198.51.100.1")]
    [InlineData("X-Azure-ClientIP", "203.0.113.7")]
    [InlineData("Forwarded", "for=203.0.113.7")]
    public void NeverFallsBackToAnotherHeader(string name, string value)
    {
        // The first X-Forwarded-For entry is whatever the caller sent; no header but the trusted one counts.
        ClientAddress.ResolveKey(Request(new() { [name] = value }), TrustedHeader).ShouldBeNull();
    }

    [Fact]
    public void IgnoresTheConnectionAddress()
    {
        // On the managed API the connection address is one platform address shared by every guest.
        ClientAddress.ResolveKey(Request([], IPAddress.Parse("192.0.2.44")), TrustedHeader).ShouldBeNull();
        ClientAddress.ResolveKey(Request([], IPAddress.Parse("192.0.2.44")), headerName: null).ShouldBeNull();
    }

    [Fact]
    public void ReadsTheTrustedHeader()
    {
        var request = Request(new() { [TrustedHeader] = "203.0.113.7", ["X-Forwarded-For"] = "198.51.100.1" }, IPAddress.Parse("192.0.2.1"));

        ClientAddress.ResolveKey(request, TrustedHeader).ShouldBe("203.0.113.7");
        ClientAddress.ResolveKey(request, "X-TRUSTED-CLIENT-IP").ShouldBe("203.0.113.7", customMessage: "header names are case-insensitive");
    }

    [Fact]
    public void DropsThePortOfTheHeaderValue()
    {
        ClientAddress.ResolveKey(Request(new() { [TrustedHeader] = "203.0.113.7:51234" }), TrustedHeader).ShouldBe("203.0.113.7");
    }

    [Theory]
    [InlineData("")]
    [InlineData(" ")]
    [InlineData("not-an-address")]
    [InlineData("203.0.113.1, 198.51.100.1")]
    public void ReturnsNoKeyWhenTheTrustedHeaderHoldsNoSingleAddress(string value)
    {
        ClientAddress.ResolveKey(Request(new() { [TrustedHeader] = value }), TrustedHeader).ShouldBeNull();
    }

    [Theory]
    [InlineData("2001:db8:1:2:3:4:5:6", "2001:db8:1:2::/64")]
    [InlineData("[2001:db8:1:2:ffff::1]:443", "2001:db8:1:2::/64")]
    [InlineData("::ffff:203.0.113.9", "203.0.113.9")]
    public void ReducesIpv6ToItsNetworkAndUnwrapsMappedIpv4(string header, string expected)
    {
        ClientAddress.ResolveKey(Request(new() { [TrustedHeader] = header }), TrustedHeader).ShouldBe(expected);
    }

    private static HttpRequest Request(Dictionary<string, string> headers, IPAddress? remoteAddress = null)
    {
        var httpContext = new DefaultHttpContext();
        httpContext.Connection.RemoteIpAddress = remoteAddress;
        foreach (var (name, value) in headers)
        {
            httpContext.Request.Headers[name] = value;
        }

        return httpContext.Request;
    }
}
