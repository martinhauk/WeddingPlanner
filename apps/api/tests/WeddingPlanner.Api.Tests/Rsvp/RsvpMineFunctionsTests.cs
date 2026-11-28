using System.Globalization;
using System.Text.Json;

using Microsoft.AspNetCore.Http;

using Shouldly;

using WeddingPlanner.Api.Tests.Support;

using Xunit;

namespace WeddingPlanner.Api.Tests.Rsvp;

public sealed class RsvpMineFunctionsTests
{
    private const string ClearedCredential = "wp_rsvp=; Max-Age=0; Path=/api/rsvp; Secure; HttpOnly; SameSite=Strict";
    private const string ClearedState = "wp_rsvp_state=; Max-Age=0; Path=/; Secure; SameSite=Lax";

    [Fact]
    public async Task GetReturnsTheOwnReplyWhileOpen()
    {
        using var harness = new RsvpHarness();
        var created = await harness.PostAsync();

        var httpContext = await harness.GetMineAsync(TestHttp.CookieHeader(created));

        httpContext.Response.StatusCode.ShouldBe(StatusCodes.Status200OK);
        httpContext.Response.Headers.CacheControl.ToString().ShouldBe("no-store");
        httpContext.Response.Headers.ETag.ToString().ShouldBe(created.Response.Headers.ETag.ToString());
        var body = TestHttp.ReadJson(httpContext);
        body.EnumerateObject().Select(property => property.Name).ShouldBe(["rsvp", "version", "open", "deadline", "editToken"]);
        body.GetProperty("editToken").GetString().ShouldBe(RsvpHarness.EditToken(created), "a returning guest can see the personal link again");
        body.GetProperty("version").GetString().ShouldBe(httpContext.Response.Headers.ETag.ToString());
        body.GetProperty("open").GetBoolean().ShouldBeTrue();
        body.GetProperty("deadline").GetString().ShouldBe("2099-07-01T21:59:00Z");
        body.GetProperty("rsvp").GetProperty("id").GetString().ShouldBe(TestHttp.ReadJson(created).GetProperty("rsvp").GetProperty("id").GetString());
        body.GetProperty("rsvp").GetProperty("people")[1].GetProperty("name").GetString().ShouldBe("María-José García");
    }

    [Fact]
    public async Task UpdateReturnsTheEditTokenOfTheOwnCookie()
    {
        using var harness = new RsvpHarness();
        var created = await harness.PostAsync();

        var updated = await harness.PutMineAsync(TestHttp.CookieHeader(created), RsvpHarness.SampleBody(attending: false), "*");

        updated.Response.StatusCode.ShouldBe(StatusCodes.Status200OK);
        TestHttp.ReadJson(updated).GetProperty("editToken").GetString().ShouldBe(RsvpHarness.EditToken(created));
    }

    [Fact]
    public async Task GetRefreshesBothCookies()
    {
        using var harness = new RsvpHarness();
        var created = await harness.PostAsync();

        var httpContext = await harness.GetMineAsync(TestHttp.CookieHeader(created));

        TestHttp.SetCookies(httpContext).ShouldBe(TestHttp.SetCookies(created));
    }

    [Fact]
    public async Task GetStillWorksAfterTheDeadlineButReportsClosed()
    {
        using var harness = new RsvpHarness();
        var created = await harness.PostAsync();
        harness.Time.SetUtcNow(RsvpHarness.DeadlineUtc.AddDays(1));

        var httpContext = await harness.GetMineAsync(TestHttp.CookieHeader(created));

        httpContext.Response.StatusCode.ShouldBe(StatusCodes.Status200OK);
        TestHttp.ReadJson(httpContext).GetProperty("open").GetBoolean().ShouldBeFalse();
    }

    [Fact]
    public async Task GetWithoutCookieIsNotFoundAndSetsNoCookie()
    {
        using var harness = new RsvpHarness();

        var httpContext = await harness.GetMineAsync(cookie: null);

        httpContext.Response.StatusCode.ShouldBe(StatusCodes.Status404NotFound);
        Code(httpContext).ShouldBe("not_found");
        TestHttp.SetCookies(httpContext).ShouldBeEmpty();
        harness.Memory.Calls.ShouldBe(0);
    }

    [Theory]
    [InlineData("wp_rsvp=00000000000000000000000000000000.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA; wp_rsvp_state=yes")]
    [InlineData("wp_rsvp=not-a-credential")]
    [InlineData("wp_rsvp_state=no")]
    public async Task GetWithAnUnknownCookieIsNotFoundAndClearsTheCookies(string cookie)
    {
        using var harness = new RsvpHarness();

        var httpContext = await harness.GetMineAsync(cookie);

        httpContext.Response.StatusCode.ShouldBe(StatusCodes.Status404NotFound);
        TestHttp.SetCookies(httpContext).ShouldBe([ClearedCredential, ClearedState]);
    }

    [Fact]
    public async Task GetWithTheWrongTokenIsNotFound()
    {
        using var harness = new RsvpHarness();
        var created = await harness.PostAsync();
        var id = TestHttp.ReadJson(created).GetProperty("rsvp").GetProperty("id").GetString();

        var httpContext = await harness.GetMineAsync($"wp_rsvp={id}.{new string('A', 43)}");

        httpContext.Response.StatusCode.ShouldBe(StatusCodes.Status404NotFound);
        TestHttp.ReadBody(httpContext).ShouldNotContain("Pablo");
    }

    [Fact]
    public async Task PutReplacesTheReplyAndKeepsPersonIds()
    {
        using var harness = new RsvpHarness();
        var created = await harness.PostAsync();
        var createdRsvp = TestHttp.ReadJson(created).GetProperty("rsvp");
        var pabloId = createdRsvp.GetProperty("people")[0].GetProperty("id").GetString();
        harness.Time.Advance(TimeSpan.FromHours(2));
        var body = new
        {
            attending = true,
            people = new object[]
            {
                new { id = pabloId, name = "Pablo Pérez", dietary = new { tags = new[] { "vegan" } } },
                new { name = "Jürgen Müller" },
            },
            language = "de",
            dietaryConsent = true,
        };

        var httpContext = await harness.PutMineAsync(TestHttp.CookieHeader(created), body, created.Response.Headers.ETag.ToString());

        httpContext.Response.StatusCode.ShouldBe(StatusCodes.Status200OK);
        httpContext.Response.Headers.ETag.ToString().ShouldNotBe(created.Response.Headers.ETag.ToString());
        var response = TestHttp.ReadJson(httpContext);
        response.GetProperty("open").GetBoolean().ShouldBeTrue();
        var rsvp = response.GetProperty("rsvp");
        rsvp.GetProperty("id").GetString().ShouldBe(createdRsvp.GetProperty("id").GetString());
        rsvp.GetProperty("language").GetString().ShouldBe("de");
        rsvp.TryGetProperty("message", out _).ShouldBeFalse();
        rsvp.GetProperty("createdAt").GetString().ShouldBe("2099-04-01T10:00:00Z");
        rsvp.GetProperty("updatedAt").GetString().ShouldBe("2099-04-01T12:00:00Z");
        var people = rsvp.GetProperty("people");
        people[0].GetProperty("id").GetString().ShouldBe(pabloId);
        people[0].GetProperty("dietary").GetProperty("tags")[0].GetString().ShouldBe("vegan");
        people[1].GetProperty("name").GetString().ShouldBe("Jürgen Müller");
        people[1].GetProperty("id").GetString().ShouldNotBe(createdRsvp.GetProperty("people")[1].GetProperty("id").GetString());
    }

    [Fact]
    public async Task PutStripsTheNoncharacterUFFFE()
    {
        using var harness = new RsvpHarness();
        var created = await harness.PostAsync();
        var body = new
        {
            attending = true,
            people = new[] { new { name = "Pablo\uFFFE Pérez", dietary = new { tags = new[] { "vegan" }, note = "Sin\uFFFE nueces" } } },
            message = "Hola\uFFFE",
            language = "es",
            dietaryConsent = true,
        };

        var httpContext = await harness.PutMineAsync(TestHttp.CookieHeader(created), body, created.Response.Headers.ETag.ToString());

        httpContext.Response.StatusCode.ShouldBe(StatusCodes.Status200OK);
        var rsvp = TestHttp.ReadJson(httpContext).GetProperty("rsvp");
        rsvp.GetProperty("message").GetString().ShouldBe("Hola");
        rsvp.GetProperty("people")[0].GetProperty("name").GetString().ShouldBe("Pablo Pérez");
        rsvp.GetProperty("people")[0].GetProperty("dietary").GetProperty("note").GetString().ShouldBe("Sin nueces");
    }

    [Fact]
    public async Task PutUpdatesTheStateCookie()
    {
        using var harness = new RsvpHarness();
        var created = await harness.PostAsync();

        var httpContext = await harness.PutMineAsync(
            TestHttp.CookieHeader(created), RsvpHarness.SampleBody(attending: false), created.Response.Headers.ETag.ToString());

        TestHttp.SetCookie(httpContext, "wp_rsvp_state").ShouldNotBeNull().ShouldStartWith("wp_rsvp_state=no;");
        TestHttp.SetCookie(httpContext, "wp_rsvp").ShouldBe(TestHttp.SetCookie(created, "wp_rsvp"));
    }

    [Fact]
    public async Task PutRequiresIfMatch()
    {
        using var harness = new RsvpHarness();
        var created = await harness.PostAsync();

        var httpContext = await harness.PutMineAsync(TestHttp.CookieHeader(created), RsvpHarness.SampleBody(), ifMatch: null);

        httpContext.Response.StatusCode.ShouldBe(StatusCodes.Status428PreconditionRequired);
        Code(httpContext).ShouldBe("precondition_required");
    }

    [Fact]
    public async Task PutWithAStaleETagFails()
    {
        using var harness = new RsvpHarness();
        var created = await harness.PostAsync();
        var cookie = TestHttp.CookieHeader(created);
        var firstETag = created.Response.Headers.ETag.ToString();
        (await harness.PutMineAsync(cookie, RsvpHarness.SampleBody(language: "de"), firstETag)).Response.StatusCode.ShouldBe(StatusCodes.Status200OK);

        var httpContext = await harness.PutMineAsync(cookie, RsvpHarness.SampleBody(language: "en"), firstETag);

        httpContext.Response.StatusCode.ShouldBe(StatusCodes.Status412PreconditionFailed);
        Code(httpContext).ShouldBe("precondition_failed");
        harness.Memory.Items.ShouldHaveSingleItem().Record.Answer.Language.ShouldBe("de");
    }

    [Fact]
    public async Task PutLosingARaceFails()
    {
        using var harness = new RsvpHarness();
        var created = await harness.PostAsync();
        harness.Memory.BeforeWrite = harness.Memory.Touch;

        var httpContext = await harness.PutMineAsync(TestHttp.CookieHeader(created), RsvpHarness.SampleBody(language: "en"), created.Response.Headers.ETag.ToString());

        httpContext.Response.StatusCode.ShouldBe(StatusCodes.Status412PreconditionFailed);
    }

    [Fact]
    public async Task PublishesAStrongETagForTheWeakStorageETag()
    {
        using var harness = new RsvpHarness();
        var created = await harness.PostAsync();
        var stored = harness.Memory.Items.ShouldHaveSingleItem().ETag;

        var etag = (await harness.GetMineAsync(TestHttp.CookieHeader(created))).Response.Headers.ETag.ToString();

        stored.ShouldStartWith("W/");
        etag.ShouldBe(stored[2..]);
    }

    [Theory]
    [InlineData("{0}")]
    [InlineData("W/{0}")]
    [InlineData("\"other\", {0}")]
    [InlineData(" \"other\" ,W/{0} ")]
    public async Task PutAcceptsTheVersionInAnIfMatchListAndIgnoresAWeakPrefix(string ifMatchFormat)
    {
        using var harness = new RsvpHarness();
        var created = await harness.PostAsync();
        var version = TestHttp.ReadJson(created).GetProperty("version").GetString().ShouldNotBeNull();

        var httpContext = await harness.PutMineAsync(
            TestHttp.CookieHeader(created), RsvpHarness.SampleBody(language: "en"), string.Format(CultureInfo.InvariantCulture, ifMatchFormat, version));

        httpContext.Response.StatusCode.ShouldBe(StatusCodes.Status200OK);
        var body = TestHttp.ReadJson(httpContext);
        body.GetProperty("version").GetString().ShouldBe(httpContext.Response.Headers.ETag.ToString());
        body.GetProperty("version").GetString().ShouldNotBe(version);
    }

    [Theory]
    [InlineData("\"other\"")]
    [InlineData("\"other\", W/\"another\"")]
    [InlineData("v1")]
    public async Task PutRejectsAnIfMatchWithoutTheCurrentVersion(string ifMatch)
    {
        using var harness = new RsvpHarness();
        var created = await harness.PostAsync();

        var httpContext = await harness.PutMineAsync(TestHttp.CookieHeader(created), RsvpHarness.SampleBody(language: "en"), ifMatch);

        httpContext.Response.StatusCode.ShouldBe(StatusCodes.Status412PreconditionFailed);
    }

    [Fact]
    public async Task PutAcceptsAWildcardIfMatch()
    {
        using var harness = new RsvpHarness();
        var created = await harness.PostAsync();

        var httpContext = await harness.PutMineAsync(TestHttp.CookieHeader(created), RsvpHarness.SampleBody(language: "en"), "*");

        httpContext.Response.StatusCode.ShouldBe(StatusCodes.Status200OK);
    }

    [Fact]
    public async Task PutValidatesTheBody()
    {
        using var harness = new RsvpHarness();
        var created = await harness.PostAsync();

        var httpContext = await harness.PutMineAsync(TestHttp.CookieHeader(created), new { attending = true, people = Array.Empty<object>(), language = "de" }, "*");

        httpContext.Response.StatusCode.ShouldBe(StatusCodes.Status400BadRequest);
        Code(httpContext).ShouldBe("validation_failed");
    }

    [Fact]
    public async Task PutRefusesAFilledHoneypotGenerically()
    {
        using var harness = new RsvpHarness();
        var created = await harness.PostAsync();
        var body = new { attending = false, people = new[] { new { name = "Pablo Pérez" } }, language = "es", website = "https://spam.example.com" };

        var httpContext = await harness.PutMineAsync(TestHttp.CookieHeader(created), body, "*");

        httpContext.Response.StatusCode.ShouldBe(StatusCodes.Status400BadRequest);
        Code(httpContext).ShouldBe("submission_rejected");
        TestHttp.ReadJson(httpContext).TryGetProperty("errors", out _).ShouldBeFalse();
        (await harness.Memory.GetAsync(TestHttp.ReadJson(created).GetProperty("rsvp").GetProperty("id").GetString()!, CancellationToken.None))
            .ShouldNotBeNull().Record.Answer.Attending.ShouldBeTrue("the reply is unchanged");
    }

    [Fact]
    public async Task PutNeedsNoFillTime()
    {
        using var harness = new RsvpHarness();
        var created = await harness.PostAsync();

        var httpContext = await harness.PutMineAsync(TestHttp.CookieHeader(created), new { attending = false, people = new[] { new { name = "Pablo Pérez" } }, language = "es" }, "*");

        httpContext.Response.StatusCode.ShouldBe(StatusCodes.Status200OK);
    }

    [Fact]
    public async Task PutAfterTheDeadlineIsClosed()
    {
        using var harness = new RsvpHarness();
        var created = await harness.PostAsync();
        harness.Time.SetUtcNow(RsvpHarness.DeadlineUtc.AddMinutes(1));

        var httpContext = await harness.PutMineAsync(TestHttp.CookieHeader(created), RsvpHarness.SampleBody(attending: false), "*");

        httpContext.Response.StatusCode.ShouldBe(StatusCodes.Status403Forbidden);
        Code(httpContext).ShouldBe("rsvp_closed");
        harness.Memory.Items.ShouldHaveSingleItem().Record.Answer.Attending.ShouldBeTrue();
    }

    [Fact]
    public async Task PutWithoutAValidCookieIsNotFound()
    {
        using var harness = new RsvpHarness();

        var httpContext = await harness.PutMineAsync("wp_rsvp_state=yes", RsvpHarness.SampleBody(), "*");

        httpContext.Response.StatusCode.ShouldBe(StatusCodes.Status404NotFound);
        TestHttp.SetCookies(httpContext).ShouldBe([ClearedCredential, ClearedState]);
    }

    [Fact]
    public async Task DeleteRemovesTheReplyAndClearsTheCookies()
    {
        using var harness = new RsvpHarness();
        var created = await harness.PostAsync();
        var cookie = TestHttp.CookieHeader(created);

        var httpContext = await harness.DeleteMineAsync(cookie);

        httpContext.Response.StatusCode.ShouldBe(StatusCodes.Status204NoContent);
        httpContext.Response.ContentLength.ShouldBe(0);
        TestHttp.SetCookies(httpContext).ShouldBe([ClearedCredential, ClearedState]);
        harness.Memory.Items.ShouldBeEmpty();
        (await harness.GetMineAsync(cookie)).Response.StatusCode.ShouldBe(StatusCodes.Status404NotFound);
    }

    [Fact]
    public async Task DeleteWithAStaleETagFails()
    {
        using var harness = new RsvpHarness();
        var created = await harness.PostAsync();
        harness.Memory.Touch(harness.Memory.Items.Single().Record.Id);

        var httpContext = await harness.DeleteMineAsync(TestHttp.CookieHeader(created), created.Response.Headers.ETag.ToString());

        httpContext.Response.StatusCode.ShouldBe(StatusCodes.Status412PreconditionFailed);
        harness.Memory.Items.Count.ShouldBe(1);
    }

    [Fact]
    public async Task DeleteAfterTheDeadlineIsClosed()
    {
        using var harness = new RsvpHarness();
        var created = await harness.PostAsync();
        harness.Time.SetUtcNow(RsvpHarness.DeadlineUtc.AddSeconds(1));

        var httpContext = await harness.DeleteMineAsync(TestHttp.CookieHeader(created));

        httpContext.Response.StatusCode.ShouldBe(StatusCodes.Status403Forbidden);
        Code(httpContext).ShouldBe("rsvp_closed");
        harness.Memory.Items.Count.ShouldBe(1);
    }

    [Fact]
    public async Task DeleteWithoutCookieIsNotFound()
    {
        using var harness = new RsvpHarness();

        var httpContext = await harness.DeleteMineAsync(cookie: null);

        httpContext.Response.StatusCode.ShouldBe(StatusCodes.Status404NotFound);
    }

    [Fact]
    public async Task EveryMethodAnswersNotConfiguredWithoutStorage()
    {
        using var harness = new RsvpHarness();
        harness.Memory.IsConfigured = false;

        (await harness.GetMineAsync("wp_rsvp_state=yes")).Response.StatusCode.ShouldBe(StatusCodes.Status503ServiceUnavailable);
        (await harness.PutMineAsync("wp_rsvp_state=yes", RsvpHarness.SampleBody(), "*")).Response.StatusCode.ShouldBe(StatusCodes.Status503ServiceUnavailable);
        (await harness.DeleteMineAsync("wp_rsvp_state=yes")).Response.StatusCode.ShouldBe(StatusCodes.Status503ServiceUnavailable);
        harness.Memory.Calls.ShouldBe(0);
    }

    private static string? Code(HttpContext httpContext)
    {
        httpContext.Response.ContentType.ShouldBe("application/problem+json");
        return TestHttp.ReadJson(httpContext).GetProperty("code").GetString();
    }
}
