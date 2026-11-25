using System.Security.Cryptography;
using System.Text;

using Microsoft.AspNetCore.Http;

using Shouldly;

using WeddingPlanner.Api.Features.Rsvp;

using Xunit;

namespace WeddingPlanner.Api.Tests.Rsvp;

public sealed class RsvpCredentialTests
{
    [Fact]
    public void NewCredentialsHaveTheCookieFormatAndAreUnique()
    {
        var credentials = Enumerable.Range(0, 50).Select(_ => RsvpCredential.CreateNew()).ToList();

        credentials.ShouldAllBe(credential => System.Text.RegularExpressions.Regex.IsMatch(
            credential.CookieValue, "^[0-9a-f]{32}\\.[A-Za-z0-9_-]{43}$"));
        credentials.Select(credential => credential.RsvpId).Distinct().Count().ShouldBe(50);
        credentials.Select(credential => credential.CookieValue.Split('.')[1]).Distinct().Count().ShouldBe(50);
    }

    [Fact]
    public void TheTokenCarriesThirtyTwoRandomBytes()
    {
        var token = RsvpCredential.CreateNew().CookieValue.Split('.')[1];

        System.Buffers.Text.Base64Url.DecodeFromChars(token).Length.ShouldBe(32);
    }

    [Fact]
    public void ParsesItsOwnCookieValue()
    {
        var credential = RsvpCredential.CreateNew();

        RsvpCredential.TryParse(credential.CookieValue, out var parsed).ShouldBeTrue();

        parsed.ShouldNotBeNull().RsvpId.ShouldBe(credential.RsvpId);
        parsed.CookieValue.ShouldBe(credential.CookieValue);
        parsed.TokenHash.ShouldBe(credential.TokenHash);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("abc")]
    [InlineData("0123456789ABCDEF0123456789abcdef.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")]
    [InlineData("0123456789abcdef0123456789abcdef.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")]
    [InlineData("0123456789abcdef0123456789abcdef.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")]
    [InlineData("0123456789abcdef0123456789abcdef.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=")]
    [InlineData("0123456789abcdef0123456789abcdef.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA+")]
    [InlineData(" 0123456789abcdef0123456789abcdef.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")]
    [InlineData("0123456789abcdef0123456789abcdef.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA.x")]
    [InlineData("0123456789abcdef0123456789abcdef/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")]
    public void RejectsAnythingButTheExactFormat(string? value)
    {
        RsvpCredential.TryParse(value, out var credential).ShouldBeFalse();
        credential.ShouldBeNull();
    }

    [Fact]
    public void TheStoredHashIsTheSha256OfTheToken()
    {
        var credential = RsvpCredential.CreateNew();
        var token = credential.CookieValue.Split('.')[1];

        credential.TokenHash.ShouldBe(Convert.ToHexStringLower(SHA256.HashData(Encoding.ASCII.GetBytes(token))));
    }

    [Fact]
    public void MatchesOnlyItsOwnHash()
    {
        var credential = RsvpCredential.CreateNew();
        var other = RsvpCredential.CreateNew();

        credential.MatchesHash(credential.TokenHash).ShouldBeTrue();
        credential.MatchesHash(credential.TokenHash.ToUpperInvariant()).ShouldBeTrue("hex decoding ignores case");
        credential.MatchesHash(other.TokenHash).ShouldBeFalse();
        credential.MatchesHash(null).ShouldBeFalse();
        credential.MatchesHash(string.Empty).ShouldBeFalse();
        credential.MatchesHash(new string('z', 64)).ShouldBeFalse();
        credential.MatchesHash(credential.TokenHash[..62]).ShouldBeFalse();
    }

    [Fact]
    public void ToStringNeverRevealsTheToken()
    {
        var credential = RsvpCredential.CreateNew();

        credential.ToString().ShouldBe(nameof(RsvpCredential));
    }

    [Fact]
    public void CookiesAreWrittenWithTheAgreedAttributes()
    {
        var credential = RsvpCredential.CreateNew();
        var httpContext = new DefaultHttpContext();

        RsvpCookies.Set(httpContext.Response, credential, attending: true, TimeSpan.FromDays(365));
        RsvpCookies.Clear(httpContext.Response);

        httpContext.Response.Headers.SetCookie.ToArray().ShouldBe(
        [
            $"wp_rsvp={credential.CookieValue}; Max-Age=31536000; Path=/api/rsvp; Secure; HttpOnly; SameSite=Strict",
            "wp_rsvp_state=yes; Max-Age=31536000; Path=/; Secure; SameSite=Lax",
            "wp_rsvp=; Max-Age=0; Path=/api/rsvp; Secure; HttpOnly; SameSite=Strict",
            "wp_rsvp_state=; Max-Age=0; Path=/; Secure; SameSite=Lax",
        ]);
    }

    [Fact]
    public void ReadsTheCredentialCookieFromTheRequest()
    {
        var httpContext = new DefaultHttpContext();
        httpContext.Request.Headers.Cookie = "other=1; wp_rsvp=abc.def; wp_rsvp_state=no";

        RsvpCookies.ReadCredential(httpContext.Request).ShouldBe("abc.def");
        RsvpCookies.HasAny(httpContext.Request).ShouldBeTrue();
        RsvpCookies.HasAny(new DefaultHttpContext().Request).ShouldBeFalse();
    }
}
