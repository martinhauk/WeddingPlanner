using Azure.Data.Tables;

using Microsoft.AspNetCore.Http;

using Shouldly;

using WeddingPlanner.Api.Features.Rsvp;
using WeddingPlanner.Api.Storage.Rsvps;
using WeddingPlanner.Api.Tests.Support;
using WeddingPlanner.Domain.Rsvp;

using Xunit;

namespace WeddingPlanner.Api.Tests.Rsvp;

/// <summary>Dietary data (possibly health data, GDPR Art. 9) is stored only with explicit consent, and the consent is recorded.</summary>
public sealed class RsvpDietaryConsentTests
{
    [Theory]
    [InlineData(null)]
    [InlineData(false)]
    public async Task PostRejectsDietaryDataWithoutConsent(bool? consent)
    {
        using var harness = new RsvpHarness();

        var httpContext = await harness.PostAsync(YesWithDiet(consent));

        Errors(httpContext).ShouldBe(["dietaryConsent:required"]);
        harness.Memory.Items.ShouldBeEmpty();
        TestHttp.SetCookies(httpContext).ShouldBeEmpty();
    }

    [Fact]
    public async Task PostRejectsADietaryNoteAloneWithoutConsent()
    {
        using var harness = new RsvpHarness();
        var body = new { attending = true, people = new[] { new { name = "Anna", dietary = new { tags = Array.Empty<string>(), note = "Keine Nüsse" } } }, language = "de" };

        Errors(await harness.PostAsync(body)).ShouldBe(["dietaryConsent:required"]);
    }

    [Fact]
    public async Task PostStoresTheConsentWithTheDietaryData()
    {
        using var harness = new RsvpHarness();

        var httpContext = await harness.PostAsync(YesWithDiet(consent: true));

        httpContext.Response.StatusCode.ShouldBe(StatusCodes.Status201Created);
        TestHttp.ReadJson(httpContext).GetProperty("rsvp").GetProperty("dietaryConsent").GetBoolean().ShouldBeTrue();
        var stored = harness.Memory.Items.ShouldHaveSingleItem().Record;
        stored.DietaryConsent.ShouldBeTrue();
        stored.DietaryConsentSource.ShouldBe(DietaryConsentSource.Guest);
        stored.DietaryConsentAt.ShouldBe(harness.Time.GetUtcNow());
        stored.DietaryConsentGuestAt.ShouldBe(harness.Time.GetUtcNow());
    }

    [Theory]
    [InlineData(null)]
    [InlineData(false)]
    [InlineData(true)]
    public async Task AReplyWithoutDietaryDataNeedsNoConsentAndStoresNone(bool? consent)
    {
        using var harness = new RsvpHarness();
        var body = new { attending = true, people = new[] { new { name = "Anna", dietary = new { tags = Array.Empty<string>() } } }, language = "de", dietaryConsent = consent };

        var httpContext = await harness.PostAsync(body);

        httpContext.Response.StatusCode.ShouldBe(StatusCodes.Status201Created);
        TestHttp.ReadJson(httpContext).GetProperty("rsvp").GetProperty("dietaryConsent").GetBoolean().ShouldBeFalse();
        harness.Memory.Items.ShouldHaveSingleItem().Record.DietaryConsent.ShouldBeFalse();
    }

    [Fact]
    public async Task ANoNeedsNoConsentBecauseItsDietaryDataIsDropped()
    {
        using var harness = new RsvpHarness();
        var body = new { attending = false, people = new[] { new { name = "Anna", dietary = new { tags = new[] { "vegan" }, note = "Keine Nüsse" } } }, language = "de" };

        var httpContext = await harness.PostAsync(body);

        httpContext.Response.StatusCode.ShouldBe(StatusCodes.Status201Created);
        harness.Memory.Items.ShouldHaveSingleItem().Record.DietaryConsent.ShouldBeFalse();
    }

    [Fact]
    public async Task PutRejectsDietaryDataWithoutConsentAndKeepsTheStoredReply()
    {
        using var harness = new RsvpHarness();
        var created = await harness.PostAsync(YesWithDiet(consent: true));

        var httpContext = await harness.PutMineAsync(TestHttp.CookieHeader(created), YesWithDiet(consent: null), created.Response.Headers.ETag.ToString());

        Errors(httpContext).ShouldBe(["dietaryConsent:required"]);
        var stored = harness.Memory.Items.ShouldHaveSingleItem().Record;
        stored.DietaryConsent.ShouldBeTrue();
        stored.Answer.People[0].DietaryTags.ShouldBe([DietaryTags.Vegan]);
    }

    [Fact]
    public async Task PutClearsTheFlagWhenTheDietaryDataIsRemoved()
    {
        using var harness = new RsvpHarness();
        var created = await harness.PostAsync(YesWithDiet(consent: true));
        var body = new { attending = true, people = new[] { new { name = "Anna" } }, language = "de" };

        var httpContext = await harness.PutMineAsync(TestHttp.CookieHeader(created), body, created.Response.Headers.ETag.ToString());

        httpContext.Response.StatusCode.ShouldBe(StatusCodes.Status200OK);
        TestHttp.ReadJson(httpContext).GetProperty("rsvp").GetProperty("dietaryConsent").GetBoolean().ShouldBeFalse();
        var stored = harness.Memory.Items.ShouldHaveSingleItem().Record;
        stored.DietaryConsent.ShouldBeFalse();
        stored.DietaryConsentSource.ShouldBeNull();
        stored.DietaryConsentAt.ShouldBeNull();
        stored.DietaryConsentGuestAt.ShouldBeNull();
    }

    [Fact]
    public async Task GetMineReturnsTheStoredFlag()
    {
        using var harness = new RsvpHarness();
        var created = await harness.PostAsync(YesWithDiet(consent: true));

        var httpContext = await harness.GetMineAsync(TestHttp.CookieHeader(created));

        TestHttp.ReadJson(httpContext).GetProperty("rsvp").GetProperty("dietaryConsent").GetBoolean().ShouldBeTrue();
    }

    [Fact]
    public void ConsentIsRequiredExactlyWhenTheReplyHasDietaryData()
    {
        var answer = new RsvpAnswer(true, [new RsvpPerson(null, "Anna", [], "Keine Nüsse")], null, "de");

        RsvpDietaryConsent.HasDietaryData(answer).ShouldBeTrue();
        RsvpDietaryConsent.Check(answer, consent: null).ShouldBe(new RsvpValidationError("dietaryConsent", "required"));
        RsvpDietaryConsent.Check(answer, consent: true).ShouldBeNull();
        RsvpDietaryConsent.HasDietaryData(answer with { People = [new RsvpPerson(null, "Anna", [], null)] }).ShouldBeFalse();
    }

    [Fact]
    public void TheTableEntityKeepsTheFlagAndOlderEntitiesReadAsNoConsent()
    {
        var record = new RsvpRecord(
            "0123456789abcdef0123456789abcdef",
            new RsvpAnswer(true, [new RsvpPerson("p1", "Anna", [DietaryTags.Vegan], null)], null, "de"),
            new string('a', 64),
            DateTimeOffset.UnixEpoch,
            DateTimeOffset.UnixEpoch,
            DietaryConsent: true,
            DietaryConsentSource: DietaryConsentSource.Admin,
            DietaryConsentAt: DateTimeOffset.UnixEpoch.AddDays(2),
            DietaryConsentGuestAt: DateTimeOffset.UnixEpoch);

        var entity = TableRsvpRepository.ToEntity(record);
        entity.GetBoolean("DietaryConsent").ShouldBe(true);
        entity.GetString("DietaryConsentSource").ShouldBe("admin");
        entity.GetDateTimeOffset("DietaryConsentGuestAt").ShouldBe(DateTimeOffset.UnixEpoch);
        var read = TableRsvpRepository.ToRecord(entity);
        read.DietaryConsent.ShouldBeTrue();
        read.DietaryConsentSource.ShouldBe(DietaryConsentSource.Admin);
        read.DietaryConsentAt.ShouldBe(DateTimeOffset.UnixEpoch.AddDays(2));
        read.DietaryConsentGuestAt.ShouldBe(DateTimeOffset.UnixEpoch);
        TableRsvpRepository.ToRecord(TableRsvpRepository.ToEntity(record with { DietaryConsentSource = DietaryConsentSource.Guest }))
            .DietaryConsentSource.ShouldBe(DietaryConsentSource.Guest);

        var older = new TableEntity(entity);
        older.Remove("DietaryConsent");
        older.Remove("DietaryConsentSource");
        older.Remove("DietaryConsentAt");
        older.Remove("DietaryConsentGuestAt");
        var olderRecord = TableRsvpRepository.ToRecord(older);
        olderRecord.DietaryConsent.ShouldBeFalse();
        olderRecord.DietaryConsentSource.ShouldBeNull();
        olderRecord.DietaryConsentAt.ShouldBeNull();
        olderRecord.DietaryConsentGuestAt.ShouldBeNull();

        // A row written after the source column but before the guest's consent time stays readable.
        var withoutGuestTime = new TableEntity(entity);
        withoutGuestTime.Remove("DietaryConsentGuestAt");
        var guestTimeMissing = TableRsvpRepository.ToRecord(withoutGuestTime);
        guestTimeMissing.DietaryConsentSource.ShouldBe(DietaryConsentSource.Admin);
        guestTimeMissing.DietaryConsentGuestAt.ShouldBeNull();
    }

    private static object YesWithDiet(bool? consent) => new
    {
        attending = true,
        people = new[] { new { name = "Anna", dietary = new { tags = new[] { "vegan" } } } },
        language = "de",
        dietaryConsent = consent,
    };

    private static List<string> Errors(HttpContext httpContext)
    {
        httpContext.Response.StatusCode.ShouldBe(StatusCodes.Status400BadRequest);
        var problem = TestHttp.ReadJson(httpContext);
        problem.GetProperty("code").GetString().ShouldBe("validation_failed");
        return problem.GetProperty("errors").EnumerateArray()
            .Select(error => $"{error.GetProperty("field").GetString()}:{error.GetProperty("code").GetString()}")
            .ToList();
    }
}
