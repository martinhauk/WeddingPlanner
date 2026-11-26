using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

using Microsoft.AspNetCore.Http;

using Shouldly;

using WeddingPlanner.Api.Tests.Support;

using Xunit;

namespace WeddingPlanner.Api.Tests.Rsvp;

public sealed class RsvpCreateFunctionTests
{
    private const string CookiePattern = "^wp_rsvp=[0-9a-f]{32}\\.[A-Za-z0-9_-]{43}; Max-Age=31536000; Path=/api/rsvp; Secure; HttpOnly; SameSite=Strict$";

    [Fact]
    public async Task CreatesTheReplyAndSetsBothCookies()
    {
        using var harness = new RsvpHarness();

        var httpContext = await harness.PostAsync();

        var response = httpContext.Response;
        response.StatusCode.ShouldBe(StatusCodes.Status201Created);
        response.ContentType.ShouldBe("application/json; charset=utf-8");
        response.Headers.CacheControl.ToString().ShouldBe("no-store");
        response.Headers.Location.ToString().ShouldBe("/api/rsvp/me");
        var etag = response.Headers.ETag.ToString();
        etag.ShouldStartWith("\"", customMessage: "a strong entity tag");
        TestHttp.ReadJson(httpContext).GetProperty("version").GetString().ShouldBe(etag);

        var credentialCookie = TestHttp.SetCookie(httpContext, "wp_rsvp").ShouldNotBeNull();
        credentialCookie.ShouldMatch(CookiePattern);
        TestHttp.SetCookie(httpContext, "wp_rsvp_state").ShouldBe("wp_rsvp_state=yes; Max-Age=31536000; Path=/; Secure; SameSite=Lax");
        TestHttp.SetCookies(httpContext).ShouldAllBe(header => !header.Contains("Expires", StringComparison.OrdinalIgnoreCase)
            && !header.Contains("Domain", StringComparison.OrdinalIgnoreCase));

        var rsvp = TestHttp.ReadJson(httpContext).GetProperty("rsvp");
        var cookieValue = credentialCookie.Split(';')[0]["wp_rsvp=".Length..];
        rsvp.GetProperty("id").GetString().ShouldBe(cookieValue.Split('.')[0]);
        rsvp.GetProperty("attending").GetBoolean().ShouldBeTrue();
        rsvp.GetProperty("language").GetString().ShouldBe("es");
        rsvp.GetProperty("message").GetString().ShouldBe("¡Felicidades, Anna y Ben!");
        rsvp.GetProperty("createdAt").GetString().ShouldBe("2099-04-01T10:00:00Z");
        rsvp.GetProperty("updatedAt").GetString().ShouldBe("2099-04-01T10:00:00Z");

        var people = rsvp.GetProperty("people").EnumerateArray().ToList();
        people.Count.ShouldBe(2);
        people[0].GetProperty("id").GetString().ShouldNotBeNullOrEmpty();
        people[0].GetProperty("name").GetString().ShouldBe("Pablo Pérez");
        people[0].GetProperty("dietary").GetProperty("tags").EnumerateArray().Select(tag => tag.GetString()).ShouldBe(["vegetarian", "glutenFree"]);
        people[0].GetProperty("dietary").GetProperty("note").GetString().ShouldBe("Sin nueces");
        people[1].GetProperty("dietary").TryGetProperty("note", out _).ShouldBeFalse("null members are omitted");
    }

    [Fact]
    public async Task StoresOnlyTheHashOfTheToken()
    {
        using var harness = new RsvpHarness();

        var httpContext = await harness.PostAsync();

        var token = TestHttp.SetCookie(httpContext, "wp_rsvp").ShouldNotBeNull().Split(';')[0].Split('.')[1];
        var stored = harness.Memory.Items.ShouldHaveSingleItem().Record;
        stored.TokenHash.ShouldBe(Convert.ToHexStringLower(SHA256.HashData(Encoding.ASCII.GetBytes(token))));
        stored.ToString().ShouldNotContain(token);
        stored.ToString().ShouldNotContain(stored.TokenHash);
    }

    [Fact]
    public async Task TheStateCookieSaysNoForANo()
    {
        using var harness = new RsvpHarness();

        var httpContext = await harness.PostAsync(RsvpHarness.SampleBody(attending: false));

        httpContext.Response.StatusCode.ShouldBe(StatusCodes.Status201Created);
        TestHttp.SetCookie(httpContext, "wp_rsvp_state").ShouldNotBeNull().ShouldStartWith("wp_rsvp_state=no;");
        var person = TestHttp.ReadJson(httpContext).GetProperty("rsvp").GetProperty("people")[0];
        person.GetProperty("dietary").GetProperty("tags").GetArrayLength().ShouldBe(0, "dietary data is not stored for a no");
        person.GetProperty("dietary").TryGetProperty("note", out _).ShouldBeFalse();
    }

    [Fact]
    public async Task AnswersConflictWhenTheBrowserAlreadyHasAValidReply()
    {
        using var harness = new RsvpHarness();
        var first = await harness.PostAsync();

        var second = await harness.PostAsync(cookie: TestHttp.CookieHeader(first));

        second.Response.StatusCode.ShouldBe(StatusCodes.Status409Conflict);
        Problem(second).GetProperty("code").GetString().ShouldBe("rsvp_exists");
        TestHttp.SetCookies(second).ShouldBeEmpty();
        harness.Memory.Items.Count.ShouldBe(1);
    }

    [Theory]
    [InlineData("wp_rsvp=00000000000000000000000000000000.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")]
    [InlineData("wp_rsvp=garbage")]
    [InlineData("wp_rsvp_state=yes")]
    public async Task CreatesANewReplyWhenTheCookieIsUnknownOrMalformed(string cookie)
    {
        using var harness = new RsvpHarness();

        var httpContext = await harness.PostAsync(cookie: cookie);

        httpContext.Response.StatusCode.ShouldBe(StatusCodes.Status201Created);
        harness.Memory.Items.Count.ShouldBe(1);
    }

    [Fact]
    public async Task CreatesANewReplyWhenTheTokenDoesNotMatch()
    {
        using var harness = new RsvpHarness();
        var first = await harness.PostAsync();
        var id = TestHttp.ReadJson(first).GetProperty("rsvp").GetProperty("id").GetString();

        var second = await harness.PostAsync(cookie: $"wp_rsvp={id}.{new string('B', 43)}");

        second.Response.StatusCode.ShouldBe(StatusCodes.Status201Created);
        harness.Memory.Items.Count.ShouldBe(2);
    }

    [Fact]
    public async Task AcceptsRepliesUntilAndIncludingTheDeadline()
    {
        using var harness = new RsvpHarness();
        harness.Time.SetUtcNow(RsvpHarness.DeadlineUtc);

        (await harness.PostAsync()).Response.StatusCode.ShouldBe(StatusCodes.Status201Created);
    }

    [Fact]
    public async Task RefusesRepliesAfterTheDeadlineWithoutStorageIo()
    {
        using var harness = new RsvpHarness();
        harness.Time.SetUtcNow(RsvpHarness.DeadlineUtc.AddSeconds(1));

        var httpContext = await harness.PostAsync();

        httpContext.Response.StatusCode.ShouldBe(StatusCodes.Status403Forbidden);
        Problem(httpContext).GetProperty("code").GetString().ShouldBe("rsvp_closed");
        harness.Memory.Calls.ShouldBe(0);
        TestHttp.SetCookies(httpContext).ShouldBeEmpty();
    }

    [Fact]
    public async Task ReportsValidationErrorsByFieldAndCode()
    {
        using var harness = new RsvpHarness();
        var body = new
        {
            attending = true,
            people = new[] { new { name = " ", dietary = new { tags = new[] { "vegan", "fish" } } } },
            message = new string('m', 1001),
            language = "de",
        };

        var httpContext = await harness.PostAsync(body);

        httpContext.Response.StatusCode.ShouldBe(StatusCodes.Status400BadRequest);
        var problem = Problem(httpContext);
        problem.GetProperty("code").GetString().ShouldBe("validation_failed");
        problem.GetProperty("errors").EnumerateArray()
            .Select(error => $"{error.GetProperty("field").GetString()}:{error.GetProperty("code").GetString()}")
            .ShouldBe(["people[0].name:required", "people[0].dietary.tags[1]:unknown_tag", "message:too_long"]);
        harness.Memory.Items.ShouldBeEmpty();
    }

    [Fact]
    public async Task RejectsMoreThanSixPeople()
    {
        using var harness = new RsvpHarness();
        var body = new { attending = true, people = Enumerable.Range(1, 7).Select(index => new { name = $"Guest {index}" }), language = "de" };

        var httpContext = await harness.PostAsync(body);

        ErrorCodes(httpContext).ShouldBe(["people:too_many"]);
    }

    [Fact]
    public async Task RejectsAFilledHoneypotWithoutStoringAnything()
    {
        using var harness = new RsvpHarness();
        var body = new { attending = true, people = new[] { new { name = "Anna" } }, language = "de", website = "https://spam.example.com" };

        var httpContext = await harness.PostAsync(body);

        ErrorCodes(httpContext).ShouldBe(["website:must_be_empty"]);
        harness.Memory.Calls.ShouldBe(0);
    }

    [Fact]
    public async Task AnswersServiceUnavailableAtTheCap()
    {
        using var harness = new RsvpHarness(settings: new Dictionary<string, string?> { ["Rsvp:MaxActiveRsvps"] = "2" });
        (await harness.PostAsync()).Response.StatusCode.ShouldBe(StatusCodes.Status201Created);
        (await harness.PostAsync()).Response.StatusCode.ShouldBe(StatusCodes.Status201Created);

        var httpContext = await harness.PostAsync();

        httpContext.Response.StatusCode.ShouldBe(StatusCodes.Status503ServiceUnavailable);
        Problem(httpContext).GetProperty("code").GetString().ShouldBe("capacity_reached");
        TestHttp.SetCookies(httpContext).ShouldBeEmpty();
        harness.Memory.Items.Count.ShouldBe(2);
    }

    [Fact]
    public async Task LogsTheCapacityWarningAtMostOncePerHour()
    {
        using var harness = new RsvpHarness(settings: new Dictionary<string, string?> { ["Rsvp:MaxActiveRsvps"] = "1" });
        (await harness.PostAsync()).Response.StatusCode.ShouldBe(StatusCodes.Status201Created);

        (await harness.PostAsync()).Response.StatusCode.ShouldBe(StatusCodes.Status503ServiceUnavailable);
        (await harness.PostAsync()).Response.StatusCode.ShouldBe(StatusCodes.Status503ServiceUnavailable);
        CapacityWarnings(harness).ShouldBe(1, "refusals are not logged one by one");

        harness.Time.Advance(TimeSpan.FromMinutes(59));
        (await harness.PostAsync()).Response.StatusCode.ShouldBe(StatusCodes.Status503ServiceUnavailable);
        CapacityWarnings(harness).ShouldBe(1);

        harness.Time.Advance(TimeSpan.FromMinutes(1));
        (await harness.PostAsync()).Response.StatusCode.ShouldBe(StatusCodes.Status503ServiceUnavailable);
        CapacityWarnings(harness).ShouldBe(2, "an hour later the cap is reported again");
    }

    [Fact]
    public async Task AnswersNotConfiguredWithoutStorage()
    {
        using var harness = new RsvpHarness();
        harness.Memory.IsConfigured = false;

        var httpContext = await harness.PostAsync();

        httpContext.Response.StatusCode.ShouldBe(StatusCodes.Status503ServiceUnavailable);
        Problem(httpContext).GetProperty("code").GetString().ShouldBe("not_configured");
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("next spring")]
    public async Task AnswersNotConfiguredWithoutAValidDeadline(string? deadline)
    {
        using var harness = new RsvpHarness(settings: new Dictionary<string, string?> { ["Rsvp:Deadline"] = deadline });

        var httpContext = await harness.PostAsync();

        httpContext.Response.StatusCode.ShouldBe(StatusCodes.Status503ServiceUnavailable);
        Problem(httpContext).GetProperty("code").GetString().ShouldBe("not_configured");
        harness.Memory.Calls.ShouldBe(0);
    }

    [Theory]
    [InlineData("{")]
    [InlineData("null")]
    [InlineData("[]")]
    [InlineData("{\"attending\":\"yes\",\"people\":[{\"name\":\"Anna\"}],\"language\":\"de\"}")]
    [InlineData("{\"attending\":true,\"attending\":false,\"people\":[{\"name\":\"Anna\"}],\"language\":\"de\"}")]
    public async Task RejectsMalformedJson(string rawBody)
    {
        using var harness = new RsvpHarness();

        var httpContext = await harness.PostAsync(rawBody: rawBody);

        httpContext.Response.StatusCode.ShouldBe(StatusCodes.Status400BadRequest);
        Problem(httpContext).GetProperty("code").GetString().ShouldBe("invalid_json");
    }

    [Theory]
    [InlineData("text/plain")]
    [InlineData("application/x-www-form-urlencoded")]
    [InlineData("application/json; charset=iso-8859-1")]
    [InlineData(null)]
    public async Task RejectsBodiesThatAreNotJson(string? contentType)
    {
        using var harness = new RsvpHarness();

        var httpContext = await harness.PostAsync(contentType: contentType);

        httpContext.Response.StatusCode.ShouldBe(StatusCodes.Status415UnsupportedMediaType);
        Problem(httpContext).GetProperty("code").GetString().ShouldBe("unsupported_media_type");
    }

    [Fact]
    public async Task RejectsBodiesOverSixteenKilobytesEvenWithoutContentLength()
    {
        using var harness = new RsvpHarness();
        var rawBody = $"{{\"attending\":true,\"people\":[{{\"name\":\"Anna\"}}],\"language\":\"de\",\"message\":\"{new string('m', 16 * 1024)}\"}}";
        var httpContext = TestHttp.Request("POST", "/api/rsvp", rawBody: rawBody);
        httpContext.Request.ContentLength = null;

        var result = await harness.CreateFunction().Run(httpContext.Request, CancellationToken.None);
        await TestHttp.ExecuteAsync(result, httpContext);

        httpContext.Response.StatusCode.ShouldBe(StatusCodes.Status413PayloadTooLarge);
        var problem = Problem(httpContext);
        problem.GetProperty("code").GetString().ShouldBe("payload_too_large");
        problem.GetProperty("maxBytes").GetInt32().ShouldBe(16 * 1024);
    }

    [Theory]
    [InlineData("name", false)]
    [InlineData("name", true)]
    [InlineData("note", false)]
    [InlineData("note", true)]
    [InlineData("message", false)]
    [InlineData("message", true)]
    public async Task StripsTheNoncharacterUFFFEInsteadOfFailing(string field, bool jsonEscape)
    {
        // U+FFFE makes string.Normalize throw. Sent raw (UTF-8 EF BF BE) or as the JSON escape, it is stripped: an
        // exception here would escape the function and become a 500 in ExceptionHandlingMiddleware.
        using var harness = new RsvpHarness();
        var bad = jsonEscape ? "\\uFFFE" : "\uFFFE";
        var name = field == "name" ? $"Anna{bad}" : "Anna";
        var note = field == "note" ? $"Ohne{bad} Nüsse" : "Ohne Nüsse";
        var message = field == "message" ? $"Hallo{bad} Ben" : "Hallo Ben";
        var rawBody = $$$"""{"attending":true,"people":[{"name":"{{{name}}}","dietary":{"tags":["vegan"],"note":"{{{note}}}"}}],"message":"{{{message}}}","language":"de","dietaryConsent":true}""";

        var httpContext = await harness.PostAsync(rawBody: rawBody);

        httpContext.Response.StatusCode.ShouldBe(StatusCodes.Status201Created);
        var rsvp = TestHttp.ReadJson(httpContext).GetProperty("rsvp");
        rsvp.GetProperty("message").GetString().ShouldBe("Hallo Ben");
        var person = rsvp.GetProperty("people")[0];
        person.GetProperty("name").GetString().ShouldBe("Anna");
        person.GetProperty("dietary").GetProperty("note").GetString().ShouldBe("Ohne Nüsse");
        harness.Logs.Records.ShouldNotContain(record => record.StartsWith("Error", StringComparison.Ordinal));
    }

    [Fact]
    public async Task ANameOfOnlyNoncharactersIsAValidationError()
    {
        using var harness = new RsvpHarness();
        var body = new { attending = true, people = new[] { new { name = "\uFFFE\uFFFF\uFDD0" } }, language = "de" };

        var httpContext = await harness.PostAsync(body);

        ErrorCodes(httpContext).ShouldBe(["people[0].name:required"]);
        harness.Memory.Calls.ShouldBe(0);
    }

    [Fact]
    public async Task IgnoresUnknownPropertiesAndClientPersonIds()
    {
        using var harness = new RsvpHarness();
        var body = new { attending = true, people = new[] { new { id = "chosen", name = "Anna" } }, language = "de", extra = 42 };

        var httpContext = await harness.PostAsync(body);

        httpContext.Response.StatusCode.ShouldBe(StatusCodes.Status201Created);
        TestHttp.ReadJson(httpContext).GetProperty("rsvp").GetProperty("people")[0].GetProperty("id").GetString().ShouldNotBe("chosen");
    }

    private static JsonElement Problem(HttpContext httpContext)
    {
        httpContext.Response.ContentType.ShouldBe("application/problem+json");
        httpContext.Response.Headers.CacheControl.ToString().ShouldBe("no-store");
        var problem = TestHttp.ReadJson(httpContext);
        problem.GetProperty("status").GetInt32().ShouldBe(httpContext.Response.StatusCode);
        return problem;
    }

    private static List<string> ErrorCodes(HttpContext httpContext)
    {
        httpContext.Response.StatusCode.ShouldBe(StatusCodes.Status400BadRequest);
        return Problem(httpContext).GetProperty("errors").EnumerateArray()
            .Select(error => $"{error.GetProperty("field").GetString()}:{error.GetProperty("code").GetString()}")
            .ToList();
    }

    private static int CapacityWarnings(RsvpHarness harness) =>
        harness.Logs.Records.Count(record => record.StartsWith("Warning", StringComparison.Ordinal) && record.Contains("RSVP capacity", StringComparison.Ordinal));
}
