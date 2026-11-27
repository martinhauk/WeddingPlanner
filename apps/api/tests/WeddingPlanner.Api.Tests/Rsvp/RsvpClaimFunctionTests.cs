using System.Net;

using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Microsoft.Extensions.Time.Testing;

using Shouldly;

using WeddingPlanner.Api.Features.Rsvp;
using WeddingPlanner.Api.Pipeline;
using WeddingPlanner.Api.RateLimiting;
using WeddingPlanner.Api.Tests.Support;

using Xunit;

namespace WeddingPlanner.Api.Tests.Rsvp;

/// <summary>
/// The personal edit link: <c>POST /api/rsvp</c> returns its secret (<c>editToken</c>), and <c>POST /api/rsvp/claim</c>
/// turns it into the RSVP cookies of another browser. Fictional data only.
/// </summary>
public sealed class RsvpClaimFunctionTests
{
    private const string CredentialPattern = "^wp_rsvp=[0-9a-f]{32}\\.[A-Za-z0-9_-]{43}; Max-Age=31536000; Path=/api/rsvp; Secure; HttpOnly; SameSite=Strict$";

    /// <summary>Well-formed, but no reply has this id.</summary>
    private const string UnknownToken = "0123456789abcdef0123456789abcdef.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

    [Fact]
    public async Task CreateReturnsTheEditTokenOfTheOwnReply()
    {
        using var harness = new RsvpHarness();

        var created = await harness.PostAsync();

        var body = TestHttp.ReadJson(created);
        body.EnumerateObject().Select(property => property.Name).ShouldBe(["rsvp", "version", "editToken"]);
        var editToken = RsvpHarness.EditToken(created);
        editToken.ShouldMatch("^[0-9a-f]{32}\\.[A-Za-z0-9_-]{43}$", "16 random bytes of id and 32 of token (256 bits)");
        editToken.ShouldStartWith(body.GetProperty("rsvp").GetProperty("id").GetString() + ".");
        TestHttp.SetCookie(created, "wp_rsvp").ShouldStartWith($"wp_rsvp={editToken};", customMessage: "the link carries the cookie's credential");
    }

    [Fact]
    public async Task EveryReplyGetsItsOwnEditToken()
    {
        using var harness = new RsvpHarness();

        var first = RsvpHarness.EditToken(await harness.PostAsync());
        var second = RsvpHarness.EditToken(await harness.PostAsync());

        first.ShouldNotBe(second);
        first.Split('.')[1].ShouldNotBe(second.Split('.')[1]);
    }

    [Fact]
    public async Task StoresOnlyTheHashOfTheEditToken()
    {
        using var harness = new RsvpHarness();

        var editToken = RsvpHarness.EditToken(await harness.PostAsync());

        var record = harness.Memory.Items.Single().Record;
        record.TokenHash.ShouldNotContain(editToken.Split('.')[1]);
        record.ToString().ShouldNotContain(editToken.Split('.')[1]);
    }

    [Fact]
    public async Task ClaimSetsBothCookiesAndReturnsTheReply()
    {
        using var harness = new RsvpHarness();
        var created = await harness.PostAsync();

        var claimed = await harness.ClaimAsync(RsvpHarness.EditToken(created));

        var response = claimed.Response;
        response.StatusCode.ShouldBe(StatusCodes.Status200OK);
        response.Headers.CacheControl.ToString().ShouldBe("no-store");
        response.Headers.ETag.ToString().ShouldBe(created.Response.Headers.ETag.ToString());
        var body = TestHttp.ReadJson(claimed);
        body.EnumerateObject().Select(property => property.Name).ShouldBe(["rsvp", "version", "open", "deadline", "editToken"]);
        body.GetProperty("open").GetBoolean().ShouldBeTrue();
        body.GetProperty("rsvp").GetProperty("people")[0].GetProperty("name").GetString().ShouldBe("Pablo Pérez");
        body.GetProperty("editToken").GetString().ShouldBe(RsvpHarness.EditToken(created), "the claimed browser can show the same link");

        TestHttp.SetCookie(claimed, "wp_rsvp").ShouldNotBeNull().ShouldMatch(CredentialPattern);
        TestHttp.SetCookie(claimed, "wp_rsvp_state").ShouldBe("wp_rsvp_state=yes; Max-Age=31536000; Path=/; Secure; SameSite=Lax");
        TestHttp.SetCookies(claimed).ShouldBe(TestHttp.SetCookies(created));
    }

    [Fact]
    public async Task TheStateCookieOfAClaimedNoSaysNo()
    {
        using var harness = new RsvpHarness();
        var created = await harness.PostAsync(RsvpHarness.SampleBody(attending: false));

        var claimed = await harness.ClaimAsync(RsvpHarness.EditToken(created));

        TestHttp.SetCookie(claimed, "wp_rsvp_state").ShouldBe("wp_rsvp_state=no; Max-Age=31536000; Path=/; Secure; SameSite=Lax");
    }

    [Fact]
    public async Task TheClaimedCookiesReadChangeAndWithdrawTheReply()
    {
        using var harness = new RsvpHarness();
        var created = await harness.PostAsync();
        var claimed = await harness.ClaimAsync(RsvpHarness.EditToken(created));
        var cookie = TestHttp.CookieHeader(claimed);

        (await harness.GetMineAsync(cookie)).Response.StatusCode.ShouldBe(StatusCodes.Status200OK);
        var updated = await harness.PutMineAsync(cookie, RsvpHarness.SampleBody(attending: false), claimed.Response.Headers.ETag.ToString());
        updated.Response.StatusCode.ShouldBe(StatusCodes.Status200OK);
        harness.Memory.Items.Single().Record.Answer.Attending.ShouldBeFalse();

        (await harness.DeleteMineAsync(cookie)).Response.StatusCode.ShouldBe(StatusCodes.Status204NoContent);
        harness.Memory.Items.ShouldBeEmpty();
    }

    [Fact]
    public async Task TheLinkKeepsWorkingAfterTheReplyWasChanged()
    {
        using var harness = new RsvpHarness();
        var created = await harness.PostAsync();
        await harness.PutMineAsync(TestHttp.CookieHeader(created), RsvpHarness.SampleBody(attending: false), "*");

        var claimed = await harness.ClaimAsync(RsvpHarness.EditToken(created));

        claimed.Response.StatusCode.ShouldBe(StatusCodes.Status200OK);
        TestHttp.ReadJson(claimed).GetProperty("rsvp").GetProperty("attending").GetBoolean().ShouldBeFalse();
    }

    [Fact]
    public async Task WithdrawingTheReplyInvalidatesTheLink()
    {
        using var harness = new RsvpHarness();
        var created = await harness.PostAsync();
        await harness.DeleteMineAsync(TestHttp.CookieHeader(created));

        var claimed = await harness.ClaimAsync(RsvpHarness.EditToken(created));

        claimed.Response.StatusCode.ShouldBe(StatusCodes.Status404NotFound);
        TestHttp.ReadJson(claimed).GetProperty("code").GetString().ShouldBe("not_found");
        TestHttp.SetCookies(claimed).ShouldBeEmpty();
    }

    [Fact]
    public async Task AWrongTokenForAnExistingReplyIsNotFound()
    {
        using var harness = new RsvpHarness();
        var created = await harness.PostAsync();
        var id = RsvpHarness.EditToken(created).Split('.')[0];

        var claimed = await harness.ClaimAsync($"{id}.{new string('A', 43)}");

        claimed.Response.StatusCode.ShouldBe(StatusCodes.Status404NotFound);
        TestHttp.SetCookies(claimed).ShouldBeEmpty();
    }

    [Theory]
    [InlineData(UnknownToken)]
    [InlineData("not-a-token")]
    [InlineData("")]
    [InlineData(null)]
    [InlineData("0123456789ABCDEF0123456789ABCDEF.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")]
    [InlineData("0123456789abcdef0123456789abcdef.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA.")]
    public async Task AnUnknownOrMalformedTokenIsNotFound(string? editToken)
    {
        using var harness = new RsvpHarness();

        var claimed = await harness.ClaimAsync(editToken);

        claimed.Response.StatusCode.ShouldBe(StatusCodes.Status404NotFound);
        TestHttp.ReadJson(claimed).GetProperty("code").GetString().ShouldBe("not_found");
        TestHttp.SetCookies(claimed).ShouldBeEmpty();
    }

    [Fact]
    public async Task EveryFailedClaimLooksTheSameSoNoIdIsRevealed()
    {
        using var harness = new RsvpHarness();
        var created = await harness.PostAsync();
        var editToken = RsvpHarness.EditToken(created);
        var id = editToken.Split('.')[0];
        var withdrawn = RsvpHarness.EditToken(await harness.PostAsync());
        await harness.DeleteMineAsync($"wp_rsvp={withdrawn}");

        var failures = new[]
        {
            await harness.ClaimAsync($"{id}.{new string('B', 43)}"),
            await harness.ClaimAsync(UnknownToken),
            await harness.ClaimAsync("garbage"),
            await harness.ClaimAsync(withdrawn),
        };

        foreach (var failure in failures)
        {
            failure.Response.StatusCode.ShouldBe(StatusCodes.Status404NotFound);
            failure.Response.ContentType.ShouldBe(failures[0].Response.ContentType);
            failure.Response.Headers.Keys.Order().ShouldBe(failures[0].Response.Headers.Keys.Order());
            TestHttp.ReadBody(failure).ShouldBe(TestHttp.ReadBody(failures[0]));
            TestHttp.ReadBody(failure).ShouldNotContain(id);
        }
    }

    [Fact]
    public async Task AFailedClaimKeepsTheBrowsersOwnReply()
    {
        using var harness = new RsvpHarness();
        var own = TestHttp.CookieHeader(await harness.PostAsync());

        var claimed = await harness.ClaimAsync(UnknownToken, cookie: own);

        claimed.Response.StatusCode.ShouldBe(StatusCodes.Status404NotFound);
        TestHttp.SetCookies(claimed).ShouldBeEmpty("a mistyped link must not clear the cookies of this browser's reply");
        (await harness.GetMineAsync(own)).Response.StatusCode.ShouldBe(StatusCodes.Status200OK);
    }

    [Fact]
    public async Task AClaimReplacesTheCookiesOfAnotherReply()
    {
        using var harness = new RsvpHarness();
        var own = await harness.PostAsync();
        var other = await harness.PostAsync(RsvpHarness.SampleBody(attending: false));

        var claimed = await harness.ClaimAsync(RsvpHarness.EditToken(other), cookie: TestHttp.CookieHeader(own));

        claimed.Response.StatusCode.ShouldBe(StatusCodes.Status200OK);
        TestHttp.SetCookies(claimed).ShouldBe(TestHttp.SetCookies(other));
    }

    [Fact]
    public async Task APreviewNamesTheLinksPeopleAndSetsNoCookie()
    {
        using var harness = new RsvpHarness();
        var own = await harness.PostAsync(RsvpHarness.SampleBody(attending: false));
        var other = await harness.PostAsync();

        var preview = await harness.ClaimAsync(RsvpHarness.EditToken(other), cookie: TestHttp.CookieHeader(own), preview: true);

        var response = preview.Response;
        response.StatusCode.ShouldBe(StatusCodes.Status200OK);
        response.Headers.CacheControl.ToString().ShouldBe("no-store");
        response.Headers.ETag.ToString().ShouldBeEmpty();
        var body = TestHttp.ReadJson(preview);
        body.EnumerateObject().Select(property => property.Name).ShouldBe(["names"], "only the names, nothing else of the reply");
        body.GetProperty("names").EnumerateArray().Select(name => name.GetString()).ShouldBe(["Pablo Pérez", "María-José García"]);
        TestHttp.SetCookies(preview).ShouldBeEmpty("a preview must not replace this browser's reply");
        (await harness.GetMineAsync(TestHttp.CookieHeader(own))).Response.StatusCode.ShouldBe(StatusCodes.Status200OK);
    }

    [Fact]
    public async Task APreviewWithoutOwnCookiesSetsNoneEither()
    {
        using var harness = new RsvpHarness();
        var created = await harness.PostAsync();

        var preview = await harness.ClaimAsync(RsvpHarness.EditToken(created), preview: true);

        preview.Response.StatusCode.ShouldBe(StatusCodes.Status200OK);
        TestHttp.SetCookies(preview).ShouldBeEmpty();
        TestHttp.ReadBody(preview).ShouldNotContain(RsvpHarness.EditToken(created).Split('.')[1]);
    }

    [Fact]
    public async Task PreviewFalseClaimsAsWithoutIt()
    {
        using var harness = new RsvpHarness();
        var created = await harness.PostAsync();

        var claimed = await harness.ClaimAsync(null, rawBody: $$"""{"editToken":"{{RsvpHarness.EditToken(created)}}","preview":false}""");

        claimed.Response.StatusCode.ShouldBe(StatusCodes.Status200OK);
        TestHttp.SetCookie(claimed, "wp_rsvp").ShouldNotBeNull();
        TestHttp.ReadJson(claimed).TryGetProperty("rsvp", out _).ShouldBeTrue();
    }

    [Fact]
    public async Task EveryFailedPreviewLooksLikeAFailedClaim()
    {
        using var harness = new RsvpHarness();
        var own = TestHttp.CookieHeader(await harness.PostAsync());
        var created = await harness.PostAsync();
        var id = RsvpHarness.EditToken(created).Split('.')[0];
        var withdrawn = RsvpHarness.EditToken(await harness.PostAsync());
        await harness.DeleteMineAsync($"wp_rsvp={withdrawn}");
        var claimFailure = await harness.ClaimAsync(UnknownToken);

        var failures = new[]
        {
            await harness.ClaimAsync($"{id}.{new string('B', 43)}", cookie: own, preview: true),
            await harness.ClaimAsync(UnknownToken, preview: true),
            await harness.ClaimAsync("garbage", cookie: own, preview: true),
            await harness.ClaimAsync(withdrawn, preview: true),
        };

        foreach (var failure in failures)
        {
            failure.Response.StatusCode.ShouldBe(StatusCodes.Status404NotFound);
            failure.Response.ContentType.ShouldBe(claimFailure.Response.ContentType);
            failure.Response.Headers.Keys.Order().ShouldBe(claimFailure.Response.Headers.Keys.Order());
            TestHttp.ReadBody(failure).ShouldBe(TestHttp.ReadBody(claimFailure));
            TestHttp.SetCookies(failure).ShouldBeEmpty();
        }
    }

    [Theory]
    [InlineData("{\"editToken\": \"a\", \"preview\": \"yes\"}")]
    [InlineData("{\"editToken\": \"a\", \"preview\": true, \"preview\": false}")]
    public async Task RejectsAMalformedPreviewFlagWithoutIo(string rawBody)
    {
        using var harness = new RsvpHarness();

        var claimed = await harness.ClaimAsync(null, rawBody: rawBody);

        claimed.Response.StatusCode.ShouldBe(StatusCodes.Status400BadRequest);
        TestHttp.ReadJson(claimed).GetProperty("code").GetString().ShouldBe("invalid_json");
        harness.Memory.Calls.ShouldBe(0);
    }

    [Fact]
    public async Task APreviewWorksAfterTheDeadline()
    {
        using var harness = new RsvpHarness();
        var created = await harness.PostAsync();
        harness.Time.SetUtcNow(RsvpHarness.DeadlineUtc.AddDays(1));

        var preview = await harness.ClaimAsync(RsvpHarness.EditToken(created), preview: true);

        preview.Response.StatusCode.ShouldBe(StatusCodes.Status200OK);
        TestHttp.SetCookies(preview).ShouldBeEmpty();
    }

    [Fact]
    public async Task AClaimWorksAfterTheDeadlineButReportsTheReplyReadOnly()
    {
        using var harness = new RsvpHarness();
        var created = await harness.PostAsync();
        harness.Time.SetUtcNow(RsvpHarness.DeadlineUtc.AddDays(1));

        var claimed = await harness.ClaimAsync(RsvpHarness.EditToken(created));

        claimed.Response.StatusCode.ShouldBe(StatusCodes.Status200OK);
        TestHttp.ReadJson(claimed).GetProperty("open").GetBoolean().ShouldBeFalse();
        TestHttp.SetCookie(claimed, "wp_rsvp").ShouldNotBeNull();
    }

    [Fact]
    public async Task AnswersNotConfiguredWithoutStorageAndWithoutIo()
    {
        using var harness = new RsvpHarness();
        harness.Memory.IsConfigured = false;

        var claimed = await harness.ClaimAsync(UnknownToken);

        claimed.Response.StatusCode.ShouldBe(StatusCodes.Status503ServiceUnavailable);
        TestHttp.ReadJson(claimed).GetProperty("code").GetString().ShouldBe("not_configured");
        harness.Memory.Calls.ShouldBe(0);
    }

    [Theory]
    [InlineData("null")]
    [InlineData("[]")]
    [InlineData("{\"editToken\": 5}")]
    [InlineData("{\"editToken\": \"a\", \"editToken\": \"b\"}")]
    public async Task RejectsMalformedJsonWithoutIo(string rawBody)
    {
        using var harness = new RsvpHarness();

        var claimed = await harness.ClaimAsync(null, rawBody: rawBody);

        claimed.Response.StatusCode.ShouldBe(StatusCodes.Status400BadRequest);
        TestHttp.ReadJson(claimed).GetProperty("code").GetString().ShouldBe("invalid_json");
        harness.Memory.Calls.ShouldBe(0);
    }

    [Fact]
    public async Task ClaimsAreRateLimitedLikeEveryWriteAndAWrongTokenCostsTheSame()
    {
        var time = new FakeTimeProvider(new DateTimeOffset(2099, 4, 1, 10, 0, 0, TimeSpan.Zero));
        var middleware = new RateLimitingMiddleware(Options.Create(LimitOptions()), time);

        // Nine wrong links and one create: the tenth write of this client in ten minutes.
        for (var index = 0; index < 9; index++)
        {
            (await InvokeAsync(middleware, RsvpClaimFunction.FunctionName)).Ran.ShouldBeTrue();
        }

        (await InvokeAsync(middleware, RsvpCreateFunction.FunctionName)).Ran.ShouldBeTrue();
        var (refused, ran) = await InvokeAsync(middleware, RsvpClaimFunction.FunctionName);

        ran.ShouldBeFalse();
        refused.Response.StatusCode.ShouldBe(StatusCodes.Status429TooManyRequests);
        TestHttp.ReadJson(refused).GetProperty("code").GetString().ShouldBe("rate_limited");
    }

    [Fact]
    public async Task ACrossSiteClaimIsRefused()
    {
        var httpContext = TestFunctionContext.CreateHttpContext();
        httpContext.Request.Method = "POST";
        httpContext.Request.ContentType = "application/json";
        httpContext.Request.Headers["Sec-Fetch-Site"] = "cross-site";
        var ran = false;

        await new RequestOriginGuardMiddleware().Invoke(new TestFunctionContext(RsvpClaimFunction.FunctionName, httpContext: httpContext), _ =>
        {
            ran = true;
            return Task.CompletedTask;
        });

        ran.ShouldBeFalse();
        httpContext.Response.StatusCode.ShouldBe(StatusCodes.Status403Forbidden);
    }

    [Fact]
    public async Task TheEditTokenIsNeverLoggedOrPrinted()
    {
        using var harness = new RsvpHarness();
        var created = await harness.PostAsync();
        var editToken = RsvpHarness.EditToken(created);
        var secret = editToken.Split('.')[1];

        var cookie = TestHttp.CookieHeader(created);
        await harness.ClaimAsync(editToken);
        await harness.ClaimAsync(editToken, preview: true);
        await harness.ClaimAsync(editToken.Split('.')[0] + "." + new string('C', 43));
        await harness.ClaimAsync(null, rawBody: "{\"editToken\": 5}");
        await harness.GetMineAsync(cookie);
        await harness.PutMineAsync(cookie, RsvpHarness.SampleBody(attending: false), "*");

        harness.Logs.Records.ShouldNotContain(record => record.Contains(secret, StringComparison.Ordinal));
        new RsvpClaimRequest(editToken, Preview: true).ToString().ShouldNotContain(secret);
        var view = harness.Memory.Items.Single();
        new RsvpCreatedResponse(RsvpView.From(view.Record), "\"v1\"", editToken).ToString().ShouldNotContain(secret);
        new RsvpMineResponse(RsvpView.From(view.Record), "\"v1\"", true, null, editToken).ToString().ShouldNotContain(secret);
        new RsvpClaimPreviewResponse(["Pablo Pérez"]).ToString().ShouldNotContain("Pablo");
    }

    private static RateLimitingOptions LimitOptions()
    {
        var services = new ServiceCollection();
        services.AddSingleton<IConfiguration>(new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?> { ["RateLimiting:ClientIpHeader"] = "x-trusted-client-ip" })
            .Build());
        services.AddRateLimiting();
        using var provider = services.BuildServiceProvider();
        return provider.GetRequiredService<IOptions<RateLimitingOptions>>().Value;
    }

    private static async Task<(DefaultHttpContext HttpContext, bool Ran)> InvokeAsync(RateLimitingMiddleware middleware, string functionName)
    {
        var httpContext = TestFunctionContext.CreateHttpContext();
        httpContext.Request.Method = "POST";
        httpContext.Connection.RemoteIpAddress = IPAddress.Parse("192.0.2.10");
        httpContext.Request.Headers["x-trusted-client-ip"] = "203.0.113.5";
        var ran = false;
        await middleware.Invoke(new TestFunctionContext(functionName, httpContext: httpContext), _ =>
        {
            ran = true;
            return Task.CompletedTask;
        });

        return (httpContext, ran);
    }
}
