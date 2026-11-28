using Microsoft.AspNetCore.Http;

using Shouldly;

using WeddingPlanner.Api.Tests.Support;

using Xunit;

namespace WeddingPlanner.Api.Tests.Admin;

/// <summary>
/// <c>GET /api/admin/rsvps</c>, <c>PUT</c> and <c>DELETE /api/admin/rsvps/{id}</c> on the in-memory repository.
/// Fictional sample guests only.
/// </summary>
public sealed class AdminRsvpsFunctionsTests
{
    [Fact]
    public async Task ListsEveryReplyLatestChangeFirstWithTotals()
    {
        using var harness = new RsvpHarness();
        await harness.PostAsync(RsvpHarness.SampleBody());
        harness.Time.Advance(TimeSpan.FromMinutes(5));
        await harness.PostAsync(Declined("Jürgen Müller", "Ben"));
        harness.Time.Advance(TimeSpan.FromMinutes(5));
        await harness.PostAsync(Single("Anna", "lactoseFree", "vegetarian"));

        var httpContext = await harness.AdminListAsync();

        httpContext.Response.StatusCode.ShouldBe(StatusCodes.Status200OK);
        httpContext.Response.Headers.CacheControl.ToString().ShouldBe("no-store");
        var body = TestHttp.ReadJson(httpContext);
        var rsvps = body.GetProperty("rsvps").EnumerateArray().ToList();
        rsvps.Select(rsvp => rsvp.GetProperty("people")[0].GetProperty("name").GetString())
            .ShouldBe(["Anna", "Jürgen Müller", "Pablo Pérez"]);
        rsvps.ShouldAllBe(rsvp => (rsvp.GetProperty("version").GetString() ?? string.Empty).StartsWith('"'));
        rsvps.ShouldAllBe(rsvp => rsvp.EnumerateObject().All(property => property.Name != "tokenHash"));

        var totals = body.GetProperty("totals");
        totals.GetProperty("replies").GetInt32().ShouldBe(3);
        totals.GetProperty("yes").GetInt32().ShouldBe(2);
        totals.GetProperty("no").GetInt32().ShouldBe(1);
        totals.GetProperty("attendingPeople").GetInt32().ShouldBe(3);
        totals.GetProperty("declinedPeople").GetInt32().ShouldBe(2);
        totals.GetProperty("dietaryNotes").GetInt32().ShouldBe(1);
        totals.GetProperty("messages").GetInt32().ShouldBe(1);
        var dietary = totals.GetProperty("dietary");
        dietary.EnumerateObject().Select(property => property.Name).ShouldBe(["vegetarian", "vegan", "glutenFree", "lactoseFree"]);
        dietary.GetProperty("vegetarian").GetInt32().ShouldBe(2);
        dietary.GetProperty("vegan").GetInt32().ShouldBe(1);
        dietary.GetProperty("glutenFree").GetInt32().ShouldBe(1);
        dietary.GetProperty("lactoseFree").GetInt32().ShouldBe(1);
    }

    [Fact]
    public async Task AnEmptyListHasZeroTotals()
    {
        using var harness = new RsvpHarness();

        var body = TestHttp.ReadJson(await harness.AdminListAsync());

        body.GetProperty("rsvps").GetArrayLength().ShouldBe(0);
        body.GetProperty("totals").GetProperty("replies").GetInt32().ShouldBe(0);
        body.GetProperty("totals").GetProperty("dietary").GetProperty("vegan").GetInt32().ShouldBe(0);
    }

    [Fact]
    public async Task WithoutStorageEveryAdminCallAnswers503()
    {
        using var harness = new RsvpHarness();
        harness.Memory.IsConfigured = false;

        (await harness.AdminListAsync()).Response.StatusCode.ShouldBe(StatusCodes.Status503ServiceUnavailable);
        (await harness.AdminPutAsync(Id, RsvpHarness.SampleBody(), "*")).Response.StatusCode.ShouldBe(StatusCodes.Status503ServiceUnavailable);
        (await harness.AdminDeleteAsync(Id)).Response.StatusCode.ShouldBe(StatusCodes.Status503ServiceUnavailable);
        (await harness.AdminExportAsync()).Response.StatusCode.ShouldBe(StatusCodes.Status503ServiceUnavailable);
        harness.Memory.Calls.ShouldBe(0);
    }

    [Fact]
    public async Task UpdateReplacesTheReplyKeepsPersonIdsAndTheGuestsCookie()
    {
        using var harness = new RsvpHarness();
        var created = await harness.PostAsync();
        var cookie = TestHttp.CookieHeader(created);
        var (id, version, people) = First(await harness.AdminListAsync());
        harness.Time.SetUtcNow(RsvpHarness.DeadlineUtc.AddDays(1)); // after the deadline: admins may still edit

        var body = new
        {
            attending = true,
            people = new object[]
            {
                new { id = people[0], name = "Pablo Pérez", dietary = new { tags = new[] { "vegan" } } },
                new { name = "Jürgen Müller", dietary = new { tags = Array.Empty<string>() } },
            },
            message = (string?)null,
            language = "es",
            website = "ignored for admins",
            dietaryConsent = true, // Pablo's tags change: the admin attests the guest's consent
        };
        var updated = await harness.AdminPutAsync(id, body, version);

        updated.Response.StatusCode.ShouldBe(StatusCodes.Status200OK);
        var rsvp = TestHttp.ReadJson(updated).GetProperty("rsvp");
        rsvp.GetProperty("id").GetString().ShouldBe(id);
        rsvp.GetProperty("people")[0].GetProperty("id").GetString().ShouldBe(people[0]);
        rsvp.GetProperty("people")[1].GetProperty("name").GetString().ShouldBe("Jürgen Müller");
        rsvp.GetProperty("version").GetString().ShouldNotBe(version);
        rsvp.TryGetProperty("message", out _).ShouldBeFalse();
        rsvp.GetProperty("updatedAt").GetDateTime().ShouldBe(harness.Time.GetUtcNow().UtcDateTime);

        var mine = TestHttp.ReadJson(await harness.GetMineAsync(cookie));
        mine.GetProperty("rsvp").GetProperty("people")[1].GetProperty("name").GetString().ShouldBe("Jürgen Müller");
    }

    [Fact]
    public async Task UpdateRequiresAMatchingVersion()
    {
        using var harness = new RsvpHarness();
        await harness.PostAsync();
        var (id, version, _) = First(await harness.AdminListAsync());

        var missing = await harness.AdminPutAsync(id, RsvpHarness.SampleBody(), ifMatch: null);
        missing.Response.StatusCode.ShouldBe(StatusCodes.Status428PreconditionRequired);

        harness.Memory.Touch(id);
        var stale = await harness.AdminPutAsync(id, RsvpHarness.SampleBody(), version);
        stale.Response.StatusCode.ShouldBe(StatusCodes.Status412PreconditionFailed);
        TestHttp.ReadJson(stale).GetProperty("code").GetString().ShouldBe("precondition_failed");
    }

    [Fact]
    public async Task UpdateValidatesTheBody()
    {
        using var harness = new RsvpHarness();
        await harness.PostAsync();
        var (id, version, _) = First(await harness.AdminListAsync());

        var invalid = await harness.AdminPutAsync(id, new { attending = true, people = Array.Empty<object>(), language = "de" }, version);

        invalid.Response.StatusCode.ShouldBe(StatusCodes.Status400BadRequest);
        TestHttp.ReadJson(invalid).GetProperty("code").GetString().ShouldBe("validation_failed");
    }

    [Theory]
    [InlineData(Id)]
    [InlineData("a'b")]
    [InlineData("")]
    public async Task AnUnknownOrMalformedIdAnswers404(string id)
    {
        using var harness = new RsvpHarness();

        (await harness.AdminPutAsync(id, RsvpHarness.SampleBody(), "*")).Response.StatusCode.ShouldBe(StatusCodes.Status404NotFound);
        (await harness.AdminDeleteAsync(id)).Response.StatusCode.ShouldBe(StatusCodes.Status404NotFound);
    }

    [Fact]
    public async Task AMalformedIdNeverReachesStorage()
    {
        using var harness = new RsvpHarness();

        await harness.AdminDeleteAsync("a'b");
        await harness.AdminPutAsync(new string('a', 65), RsvpHarness.SampleBody(), "*");

        harness.Memory.Calls.ShouldBe(0);
    }

    [Fact]
    public async Task DeleteRemovesTheReplyAfterTheDeadlineToo()
    {
        using var harness = new RsvpHarness();
        var cookie = TestHttp.CookieHeader(await harness.PostAsync());
        var (id, version, _) = First(await harness.AdminListAsync());
        harness.Time.SetUtcNow(RsvpHarness.DeadlineUtc.AddDays(1));

        var deleted = await harness.AdminDeleteAsync(id, version);

        deleted.Response.StatusCode.ShouldBe(StatusCodes.Status204NoContent);
        harness.Memory.Items.ShouldBeEmpty();
        (await harness.GetMineAsync(cookie)).Response.StatusCode.ShouldBe(StatusCodes.Status404NotFound);
        (await harness.AdminDeleteAsync(id)).Response.StatusCode.ShouldBe(StatusCodes.Status404NotFound);
    }

    [Fact]
    public async Task DeleteWithAStaleVersionAnswers412()
    {
        using var harness = new RsvpHarness();
        await harness.PostAsync();
        var (id, version, _) = First(await harness.AdminListAsync());
        harness.Memory.Touch(id);

        (await harness.AdminDeleteAsync(id, version)).Response.StatusCode.ShouldBe(StatusCodes.Status412PreconditionFailed);
        harness.Memory.Items.Count.ShouldBe(1);
    }

    [Fact]
    public async Task ExportIsADownloadableUtf8CsvWithBom()
    {
        using var harness = new RsvpHarness();
        await harness.PostAsync();

        var httpContext = await harness.AdminExportAsync();

        httpContext.Response.StatusCode.ShouldBe(StatusCodes.Status200OK);
        httpContext.Response.ContentType.ShouldBe("text/csv; charset=utf-8");
        httpContext.Response.Headers.CacheControl.ToString().ShouldBe("no-store");
        httpContext.Response.Headers.XContentTypeOptions.ToString().ShouldBe("nosniff");
        httpContext.Response.Headers.ContentDisposition.ToString().ShouldBe("attachment; filename=\"antworten-2099-04-01.csv\"");
        var bytes = AdminCalls.ReadBytes(httpContext);
        bytes.Take(3).ShouldBe(new byte[] { 0xEF, 0xBB, 0xBF });
        var lines = System.Text.Encoding.UTF8.GetString(bytes, 3, bytes.Length - 3).Split("\r\n");
        lines.Length.ShouldBe(4, "header, two people, trailing line end");
        lines[1].ShouldContain("\"Pablo Pérez\"");
        lines[1].ShouldContain("\"2099-04-01 12:00\"", customMessage: "times in the RSVP time zone (Berlin, summer time)");
        lines[2].ShouldContain("\"María-José García\"");
    }

    private const string Id = "0123456789abcdef0123456789abcdef";

    private static (string Id, string Version, string[] PersonIds) First(HttpContext list)
    {
        var rsvp = TestHttp.ReadJson(list).GetProperty("rsvps")[0];
        return (
            rsvp.GetProperty("id").GetString().ShouldNotBeNull(),
            rsvp.GetProperty("version").GetString().ShouldNotBeNull(),
            rsvp.GetProperty("people").EnumerateArray().Select(person => person.GetProperty("id").GetString().ShouldNotBeNull()).ToArray());
    }

    private static object Declined(params string[] names) => new
    {
        attending = false,
        people = names.Select(name => new { name }).ToArray(),
        language = "de",
        website = string.Empty,
    };

    private static object Single(string name, params string[] tags) => new
    {
        attending = true,
        people = new[] { new { name, dietary = new { tags } } },
        language = "en",
        website = string.Empty,
        dietaryConsent = true,
    };
}
