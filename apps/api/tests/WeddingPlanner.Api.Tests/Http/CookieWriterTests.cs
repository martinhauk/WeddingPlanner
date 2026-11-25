using System.Text.RegularExpressions;

using Microsoft.AspNetCore.Http;

using Shouldly;

using WeddingPlanner.Api.Http;

using Xunit;

namespace WeddingPlanner.Api.Tests.Http;

public sealed partial class CookieWriterTests
{
    private static readonly TimeSpan _rsvpLifetime = TimeSpan.FromDays(365);

    [Fact]
    public void SetWritesTheProbeCookieWithMaxAgeOnly()
    {
        var response = NewResponse();

        new CookieWriter("wp_probe", "/api/health").Set(response, "1", TimeSpan.FromSeconds(60));

        SetCookieHeaders(response).ShouldBe(["wp_probe=1; Max-Age=60; Path=/api/health; Secure; HttpOnly; SameSite=Strict"]);
    }

    [Fact]
    public void SetWritesAnHttpOnlyStrictCookieByDefault()
    {
        var response = NewResponse();

        new CookieWriter("wp_rsvp", "/api/rsvp").Set(response, "0f8c2a1e.AbC-dEf_123", _rsvpLifetime);

        SetCookieHeaders(response).ShouldBe(["wp_rsvp=0f8c2a1e.AbC-dEf_123; Max-Age=31536000; Path=/api/rsvp; Secure; HttpOnly; SameSite=Strict"]);
    }

    [Fact]
    public void SetWritesAScriptReadableLaxCookie()
    {
        var response = NewResponse();

        new CookieWriter("wp_rsvp_state", "/", httpOnly: false, SameSiteMode.Lax).Set(response, "yes", _rsvpLifetime);

        SetCookieHeaders(response).ShouldBe(["wp_rsvp_state=yes; Max-Age=31536000; Path=/; Secure; SameSite=Lax"]);
    }

    [Fact]
    public void ClearUsesMaxAgeZeroWithTheSamePathAndAttributes()
    {
        var response = NewResponse();

        new CookieWriter("wp_rsvp", "/api/rsvp").Clear(response);
        new CookieWriter("wp_rsvp_state", "/", httpOnly: false, SameSiteMode.Lax).Clear(response);

        SetCookieHeaders(response).ShouldBe(
        [
            "wp_rsvp=; Max-Age=0; Path=/api/rsvp; Secure; HttpOnly; SameSite=Strict",
            "wp_rsvp_state=; Max-Age=0; Path=/; Secure; SameSite=Lax",
        ]);
    }

    [Fact]
    public void NeverWritesExpiresOrDomain()
    {
        var response = NewResponse();
        var writer = new CookieWriter("wp_probe", "/api/health");

        writer.Set(response, "1", CookieWriter.MaxLifetime);
        writer.Set(response, "1", TimeSpan.FromSeconds(1));
        writer.Clear(response);

        SetCookieHeaders(response).Count.ShouldBe(3);
        SetCookieHeaders(response).ShouldAllBe(header =>
            !header.Contains("expires", StringComparison.OrdinalIgnoreCase) && !header.Contains("domain", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void AcceptsTheMaximumLifetimeOf400Days()
    {
        var response = NewResponse();

        new CookieWriter("wp_probe", "/api/health").Set(response, "1", TimeSpan.FromDays(400));

        SetCookieHeaders(response).ShouldBe(["wp_probe=1; Max-Age=34560000; Path=/api/health; Secure; HttpOnly; SameSite=Strict"]);
        CookieWriter.MaxLifetime.ShouldBe(TimeSpan.FromDays(400));
    }

    [Fact]
    public void KeepsCookiesThatWereAlreadyAdded()
    {
        var response = NewResponse();

        new CookieWriter("wp_rsvp", "/api/rsvp").Set(response, "abc", _rsvpLifetime);
        new CookieWriter("wp_rsvp_state", "/", httpOnly: false, SameSiteMode.Lax).Set(response, "no", _rsvpLifetime);

        SetCookieHeaders(response).Select(header => header.Split('=')[0]).ShouldBe(["wp_rsvp", "wp_rsvp_state"]);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    [InlineData((400 * 86_400) + 1)]
    public void RejectsALifetimeOutsideOneSecondTo400Days(int seconds)
    {
        var writer = new CookieWriter("wp_probe", "/api/health");

        Should.Throw<ArgumentOutOfRangeException>(() => writer.Set(NewResponse(), "1", TimeSpan.FromSeconds(seconds)));
    }

    [Fact]
    public void RejectsFractionalSeconds()
    {
        var writer = new CookieWriter("wp_probe", "/api/health");

        Should.Throw<ArgumentOutOfRangeException>(() => writer.Set(NewResponse(), "1", TimeSpan.FromMilliseconds(1500)));
    }

    [Theory]
    [InlineData("a b")]
    [InlineData("a;b")]
    [InlineData("a,b")]
    [InlineData("a\"b")]
    [InlineData("a\\b")]
    [InlineData("a%20b")]
    [InlineData("Jürgen")]
    [InlineData("a\tb")]
    public void RejectsValuesThatAreNotPlainCookieOctets(string value)
    {
        var writer = new CookieWriter("wp_probe", "/api/health");
        var response = NewResponse();

        Should.Throw<ArgumentException>(() => writer.Set(response, value, TimeSpan.FromSeconds(60)));
        SetCookieHeaders(response).ShouldBeEmpty();
    }

    [Fact]
    public void RejectsAnEmptyValueBecauseClearingIsExplicit()
    {
        var writer = new CookieWriter("wp_probe", "/api/health");

        Should.Throw<ArgumentException>(() => writer.Set(NewResponse(), string.Empty, TimeSpan.FromSeconds(60)));
    }

    [Theory]
    [InlineData("")]
    [InlineData("wp rsvp")]
    [InlineData("wp;rsvp")]
    [InlineData("wp=rsvp")]
    [InlineData("wp/rsvp")]
    [InlineData("wp_rsvé")]
    public void RejectsNamesThatAreNotTokens(string name)
    {
        Should.Throw<ArgumentException>(() => new CookieWriter(name, "/"));
    }

    [Theory]
    [InlineData("")]
    [InlineData("api/rsvp")]
    [InlineData("/api;rsvp")]
    [InlineData("/api rsvp")]
    public void RejectsPathsThatAreNotAbsoluteOrContainSeparators(string path)
    {
        Should.Throw<ArgumentException>(() => new CookieWriter("wp_rsvp", path));
    }

    [Theory]
    [InlineData(SameSiteMode.None)]
    [InlineData(SameSiteMode.Unspecified)]
    public void AllowsOnlyStrictOrLax(SameSiteMode sameSite)
    {
        Should.Throw<ArgumentOutOfRangeException>(() => new CookieWriter("wp_rsvp", "/api/rsvp", sameSite: sameSite));
    }

    [Fact]
    public void AValueReadsBackUnchangedFromTheCookieHeader()
    {
        // ASP.NET Core URL-unescapes request cookies; values without '%' survive the round trip verbatim.
        const string value = "0f8c2a1e-77aa.AbC-dEf_123~!*()";
        var response = NewResponse();
        new CookieWriter("wp_rsvp", "/api/rsvp").Set(response, value, _rsvpLifetime);
        var nameAndValue = SetCookieHeaders(response).ShouldHaveSingleItem().Split(';')[0];

        var request = new DefaultHttpContext().Request;
        request.Headers.Cookie = nameAndValue;

        request.Cookies["wp_rsvp"].ShouldBe(value);
    }

    [Fact]
    public void NoOtherApiCodeWritesCookies()
    {
        // CookieWriter is the only way to set cookies (apps/api/CLAUDE.md). Comments are not stripped: name the
        // forbidden APIs in prose without their call syntax.
        var sourceDirectory = Path.Combine(FindRepositoryRoot(), "apps", "api", "src", "WeddingPlanner.Api");
        var cookieWriterPath = Path.Combine(sourceDirectory, "Http", "CookieWriter.cs");
        var sources = Directory.EnumerateFiles(sourceDirectory, "*.cs", SearchOption.AllDirectories)
            .Where(path => !IsBuildOutput(sourceDirectory, path) && path != cookieWriterPath)
            .ToList();

        sources.ShouldNotBeEmpty();
        sources.Where(path => CookieWritingApi().IsMatch(File.ReadAllText(path)))
            .Select(path => Path.GetRelativePath(sourceDirectory, path))
            .ShouldBeEmpty("set and clear cookies only through Http/CookieWriter");
    }

    [Theory]
    [InlineData("response.Cookies.Append(\"wp_rsvp\", token);")]
    [InlineData("context.Response.Cookies . Delete(\"wp_rsvp\");")]
    [InlineData("response.Headers.SetCookie = value;")]
    [InlineData("response.Headers.Append(HeaderNames.SetCookie, value);")]
    [InlineData("response.Headers[\"set-cookie\"] = value;")]
    [InlineData("var header = new SetCookieHeaderValue(\"wp_rsvp\");")]
    [InlineData("IResponseCookies cookies = response.Cookies;")]
    public void TheGuardRecognisesDirectCookieWrites(string code)
    {
        CookieWritingApi().IsMatch(code).ShouldBeTrue();
    }

    [Theory]
    [InlineData("request.Cookies.TryGetValue(\"wp_rsvp\", out var token)")]
    [InlineData("var token = request.Cookies[\"wp_rsvp\"];")]
    [InlineData("Cookie.Set(response, token, lifetime);")]
    public void TheGuardAllowsReadingCookiesAndUsingCookieWriter(string code)
    {
        CookieWritingApi().IsMatch(code).ShouldBeFalse();
    }

    [GeneratedRegex(
        @"\.\s*Cookies\s*\.\s*(Append|Delete)\b|\bSetCookie(HeaderValue)?\b|""set-cookie""|\bIResponseCookies\b",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex CookieWritingApi();

    private static HttpResponse NewResponse() => new DefaultHttpContext().Response;

    private static List<string> SetCookieHeaders(HttpResponse response) =>
        response.Headers.SetCookie.Select(header => header ?? string.Empty).ToList();

    private static bool IsBuildOutput(string root, string path)
    {
        var firstSegment = Path.GetRelativePath(root, path).Split(Path.DirectorySeparatorChar)[0];
        return firstSegment is "bin" or "obj";
    }

    private static string FindRepositoryRoot()
    {
        for (var directory = new DirectoryInfo(AppContext.BaseDirectory); directory is not null; directory = directory.Parent)
        {
            if (File.Exists(Path.Combine(directory.FullName, "WeddingPlanner.slnx")))
            {
                return directory.FullName;
            }
        }

        throw new InvalidOperationException("WeddingPlanner.slnx not found above the test output directory.");
    }
}
