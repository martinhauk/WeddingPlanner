using System.Net;

using Microsoft.AspNetCore.Http;

using Shouldly;

using WeddingPlanner.Api.Http;

using Xunit;

namespace WeddingPlanner.Api.Tests.Http;

/// <summary>Documentation addresses only (RFC 5737, RFC 3849).</summary>
public sealed class ClientAddressTests
{
    [Fact]
    public void PrefersTheClientIpHeader()
    {
        var request = Request(new() { ["X-Azure-ClientIP"] = "203.0.113.7", ["X-Forwarded-For"] = "198.51.100.1" }, IPAddress.Parse("192.0.2.1"));

        ClientAddress.ResolveKey(request).ShouldBe("203.0.113.7");
    }

    [Fact]
    public void DropsThePortOfTheHeaderValue()
    {
        ClientAddress.ResolveKey(Request(new() { ["X-Azure-ClientIP"] = "203.0.113.7:51234" })).ShouldBe("203.0.113.7");
    }

    [Fact]
    public void FallsBackToTheFirstForwardedForEntryWithoutPort()
    {
        var request = Request(new() { ["X-Azure-ClientIP"] = "not-an-address", ["X-Forwarded-For"] = "198.51.100.10:443, 203.0.113.1" });

        ClientAddress.ResolveKey(request).ShouldBe("198.51.100.10");
    }

    [Fact]
    public void IgnoresTheConnectionAddress()
    {
        // On the Functions host the connection address is the host or proxy peer, the same for every guest.
        ClientAddress.ResolveKey(Request([], IPAddress.Parse("192.0.2.44"))).ShouldBeNull();
    }

    [Fact]
    public void ReturnsNoKeyWithoutAnyAddress()
    {
        ClientAddress.ResolveKey(Request([])).ShouldBeNull();
    }

    [Theory]
    [InlineData("not-an-address", "")]
    [InlineData("", "unknown, 203.0.113.1")]
    [InlineData(" ", " , 203.0.113.1")]
    public void ReturnsNoKeyWhenNoHeaderYieldsAnAddress(string clientIpHeader, string forwardedFor)
    {
        var request = Request(new() { ["X-Azure-ClientIP"] = clientIpHeader, ["X-Forwarded-For"] = forwardedFor }, IPAddress.Parse("192.0.2.44"));

        ClientAddress.ResolveKey(request).ShouldBeNull();
    }

    [Fact]
    public void SkipsTheHeaderWhenNoneIsConfigured()
    {
        var request = Request(new() { ["X-Azure-ClientIP"] = "203.0.113.7", ["X-Forwarded-For"] = "198.51.100.1" });

        ClientAddress.ResolveKey(request, headerName: string.Empty).ShouldBe("198.51.100.1");
        ClientAddress.ResolveKey(request, headerName: "x-client-ip").ShouldBe("198.51.100.1");
    }

    [Theory]
    [InlineData("2001:db8:1:2:3:4:5:6", "2001:db8:1:2::/64")]
    [InlineData("[2001:db8:1:2:ffff::1]:443", "2001:db8:1:2::/64")]
    [InlineData("::ffff:203.0.113.9", "203.0.113.9")]
    public void ReducesIpv6ToItsNetworkAndUnwrapsMappedIpv4(string header, string expected)
    {
        ClientAddress.ResolveKey(Request(new() { ["X-Azure-ClientIP"] = header })).ShouldBe(expected);
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
