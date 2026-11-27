using Microsoft.AspNetCore.Http;

using Shouldly;

using WeddingPlanner.Api.Features.Admin.Rsvps;
using WeddingPlanner.Api.Storage.Rsvps;
using WeddingPlanner.Api.Tests.Support;
using WeddingPlanner.Domain.Rsvp;

using Xunit;

namespace WeddingPlanner.Api.Tests.Admin;

/// <summary>
/// <c>PUT /api/admin/rsvps/{id}</c> stores new or changed dietary data (possibly health data, GDPR Art. 9) only with the
/// admin's attestation that the guest explicitly consented, and records it. Fictional sample guests only.
/// </summary>
public sealed class AdminDietaryConsentTests
{
    [Theory]
    [InlineData(null)]
    [InlineData(false)]
    public async Task AddingDietaryDataWithoutTheAttestationIs400AndKeepsTheReply(bool? attestation)
    {
        using var harness = new RsvpHarness();
        await harness.PostAsync(Reply(Person("Jürgen Müller")));
        var (id, version, people) = await First(harness);

        var httpContext = await harness.AdminPutAsync(id, Reply(Person("Jürgen Müller", people[0], ["vegan"])) with { DietaryConsent = attestation }, version);

        Errors(httpContext).ShouldBe(["dietaryConsent:required"]);
        var stored = Stored(harness);
        stored.Answer.People[0].DietaryTags.ShouldBeEmpty();
        stored.DietaryConsent.ShouldBeFalse();
        stored.DietaryConsentSource.ShouldBeNull();
    }

    [Fact]
    public async Task ChangingANoteOrAddingATagOrAPersonWithDietaryDataNeedsTheAttestation()
    {
        using var harness = new RsvpHarness();
        await harness.PostAsync(Reply(Person("Pablo Pérez", tags: ["vegetarian"], note: "Sin nueces")) with { DietaryConsent = true });
        var (id, version, people) = await First(harness);

        var changes = new[]
        {
            Reply(Person("Pablo Pérez", people[0], ["vegetarian"], "Sin nueces ni cacahuetes")),
            Reply(Person("Pablo Pérez", people[0], ["vegetarian", "glutenFree"], "Sin nueces")),
            Reply(Person("Pablo Pérez", people[0], ["vegetarian"], "Sin nueces"), Person("María-José García", tags: ["vegan"])),
            Reply(Person("Pablo Pérez", people[0], ["vegetarian"], "Sin nueces"), Person("María-José García", note: "Sin lactosa")),
        };
        foreach (var change in changes)
        {
            Errors(await harness.AdminPutAsync(id, change, version)).ShouldBe(["dietaryConsent:required"]);
        }

        Stored(harness).DietaryConsentSource.ShouldBe(DietaryConsentSource.Guest);
    }

    [Fact]
    public async Task WithTheAttestationTheDataIsStoredAndTheConsentRecordedAsAnAdminAttestation()
    {
        using var harness = new RsvpHarness();
        await harness.PostAsync(Reply(Person("Pablo Pérez", tags: ["vegetarian"])) with { DietaryConsent = true });
        var (id, version, people) = await First(harness);
        harness.Time.Advance(TimeSpan.FromDays(60)); // after the deadline: admins may still edit

        var httpContext = await harness.AdminPutAsync(id, Reply(Person("Pablo Pérez", people[0], ["vegetarian"], "Sin nueces")) with { DietaryConsent = true }, version);

        httpContext.Response.StatusCode.ShouldBe(StatusCodes.Status200OK);
        var stored = Stored(harness);
        stored.Answer.People[0].DietaryNote.ShouldBe("Sin nueces");
        stored.DietaryConsent.ShouldBeTrue();
        stored.DietaryConsentSource.ShouldBe(DietaryConsentSource.Admin);
        stored.DietaryConsentAt.ShouldBe(harness.Time.GetUtcNow());
    }

    [Fact]
    public async Task UnchangedDietaryDataNeedsNoAttestationAndKeepsTheGuestsConsent()
    {
        using var harness = new RsvpHarness();
        var consentedAt = harness.Time.GetUtcNow();
        await harness.PostAsync(Reply(Person("Pablo Pérez", tags: ["vegetarian", "glutenFree"], note: "Sin nueces")) with { DietaryConsent = true });
        var (id, version, people) = await First(harness);
        harness.Time.Advance(TimeSpan.FromDays(1));

        // A new message and a companion without dietary data; Pablo and his dietary data stay the same.
        var edit = Reply(Person("Pablo Pérez", people[0], ["vegetarian", "glutenFree"], "Sin nueces"), Person("María-José García")) with
        {
            Message = "¡Hasta pronto!",
        };
        var httpContext = await harness.AdminPutAsync(id, edit, version);

        httpContext.Response.StatusCode.ShouldBe(StatusCodes.Status200OK);
        var stored = Stored(harness);
        stored.Answer.People.Select(person => person.Name).ShouldBe(["Pablo Pérez", "María-José García"]);
        stored.DietaryConsent.ShouldBeTrue();
        stored.DietaryConsentSource.ShouldBe(DietaryConsentSource.Guest);
        stored.DietaryConsentAt.ShouldBe(consentedAt);
    }

    [Fact]
    public async Task RenamingAPersonWhoKeepsDietaryDataNeedsTheAttestation()
    {
        using var harness = new RsvpHarness();
        await harness.PostAsync(Reply(Person("Pablo Pérez", tags: ["vegetarian"], note: "Sin nueces"), Person("Jürgen Müller")) with { DietaryConsent = true });
        var (id, version, people) = await First(harness);
        harness.Time.Advance(TimeSpan.FromDays(1));

        // The same slot now names someone else, who would take over Pablo's dietary data.
        var renamed = Reply(Person("María-José García", people[0], ["vegetarian"], "Sin nueces"), Person("Jürgen Müller", people[1]));
        Errors(await harness.AdminPutAsync(id, renamed, version)).ShouldBe(["dietaryConsent:required"]);
        Stored(harness).Answer.People[0].Name.ShouldBe("Pablo Pérez");

        var attested = await harness.AdminPutAsync(id, renamed with { DietaryConsent = true }, version);

        attested.Response.StatusCode.ShouldBe(StatusCodes.Status200OK);
        var stored = Stored(harness);
        stored.Answer.People[0].Name.ShouldBe("María-José García");
        stored.DietaryConsentSource.ShouldBe(DietaryConsentSource.Admin);
        stored.DietaryConsentAt.ShouldBe(harness.Time.GetUtcNow());
    }

    [Fact]
    public async Task RenamingAPersonWithoutDietaryDataNeedsNoAttestation()
    {
        using var harness = new RsvpHarness();
        var consentedAt = harness.Time.GetUtcNow();
        await harness.PostAsync(Reply(Person("Pablo Pérez", tags: ["vegan"]), Person("Jürgen Müller")) with { DietaryConsent = true });
        var (id, version, people) = await First(harness);
        harness.Time.Advance(TimeSpan.FromDays(1));

        // Jürgen has no dietary data: renaming him keeps Pablo's consent as it is.
        var renameJuergen = await harness.AdminPutAsync(id, Reply(Person("Pablo Pérez", people[0], ["vegan"]), Person("María-José García", people[1])), version);

        renameJuergen.Response.StatusCode.ShouldBe(StatusCodes.Status200OK);
        Stored(harness).DietaryConsentSource.ShouldBe(DietaryConsentSource.Guest);
        Stored(harness).DietaryConsentAt.ShouldBe(consentedAt);

        // Renaming Pablo in the same edit that removes his dietary data moves nothing to anyone.
        var newVersion = TestHttp.ReadJson(renameJuergen).GetProperty("rsvp").GetProperty("version").GetString();
        var renamePablo = await harness.AdminPutAsync(id, Reply(Person("Pablo Pérez García", people[0]), Person("María-José García", people[1])), newVersion);

        renamePablo.Response.StatusCode.ShouldBe(StatusCodes.Status200OK);
        var stored = Stored(harness);
        stored.Answer.People.Select(person => person.Name).ShouldBe(["Pablo Pérez García", "María-José García"]);
        stored.DietaryConsent.ShouldBeFalse();
    }

    [Fact]
    public async Task AnAttestationForUnchangedDataNeverReplacesTheGuestsOwnConsent()
    {
        using var harness = new RsvpHarness();
        var consentedAt = harness.Time.GetUtcNow();
        await harness.PostAsync(Reply(Person("Pablo Pérez", tags: ["vegan"])) with { DietaryConsent = true });
        var (id, version, people) = await First(harness);
        harness.Time.Advance(TimeSpan.FromDays(1));

        (await harness.AdminPutAsync(id, Reply(Person("Pablo Pérez", people[0], ["vegan"])) with { DietaryConsent = true }, version))
            .Response.StatusCode.ShouldBe(StatusCodes.Status200OK);

        Stored(harness).DietaryConsentSource.ShouldBe(DietaryConsentSource.Guest);
        Stored(harness).DietaryConsentAt.ShouldBe(consentedAt);
    }

    [Fact]
    public async Task RemovingSomeDietaryDataNeedsNoAttestationAndKeepsTheConsent()
    {
        using var harness = new RsvpHarness();
        await harness.PostAsync(Reply(Person("Pablo Pérez", tags: ["vegetarian", "glutenFree"], note: "Sin nueces"), Person("María-José García", tags: ["vegan"])) with { DietaryConsent = true });
        var (id, version, people) = await First(harness);

        // One tag and the note go, and María-José is removed with her tag.
        var httpContext = await harness.AdminPutAsync(id, Reply(Person("Pablo Pérez", people[0], ["vegetarian"])), version);

        httpContext.Response.StatusCode.ShouldBe(StatusCodes.Status200OK);
        var stored = Stored(harness);
        stored.Answer.People.ShouldHaveSingleItem().DietaryTags.ShouldBe([DietaryTags.Vegetarian]);
        stored.DietaryConsent.ShouldBeTrue();
        stored.DietaryConsentSource.ShouldBe(DietaryConsentSource.Guest);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task RemovingAllDietaryDataClearsTheConsent(bool attending)
    {
        using var harness = new RsvpHarness();
        await harness.PostAsync(Reply(Person("Pablo Pérez", tags: ["vegan"], note: "Sin nueces")) with { DietaryConsent = true });
        var (id, version, people) = await First(harness);

        // Either the dietary data is removed, or the reply becomes a "no", whose dietary data is dropped.
        var edit = attending
            ? Reply(Person("Pablo Pérez", people[0]))
            : Reply(Person("Pablo Pérez", people[0], ["vegan"], "Sin nueces")) with { Attending = false };
        var httpContext = await harness.AdminPutAsync(id, edit, version);

        httpContext.Response.StatusCode.ShouldBe(StatusCodes.Status200OK);
        var stored = Stored(harness);
        stored.DietaryConsent.ShouldBeFalse();
        stored.DietaryConsentSource.ShouldBeNull();
        stored.DietaryConsentAt.ShouldBeNull();
    }

    [Fact]
    public async Task AGuestWriteAfterAnAdminAttestationRecordsTheGuestsOwnConsent()
    {
        using var harness = new RsvpHarness();
        var created = await harness.PostAsync(Reply(Person("Pablo Pérez")));
        var (id, version, people) = await First(harness);
        var adminEdit = await harness.AdminPutAsync(id, Reply(Person("Pablo Pérez", people[0], ["vegan"])) with { DietaryConsent = true }, version);
        Stored(harness).DietaryConsentSource.ShouldBe(DietaryConsentSource.Admin);
        harness.Time.Advance(TimeSpan.FromHours(1));

        var newVersion = TestHttp.ReadJson(adminEdit).GetProperty("rsvp").GetProperty("version").GetString();
        var guestEdit = await harness.PutMineAsync(TestHttp.CookieHeader(created), Reply(Person("Pablo Pérez", people[0], ["vegan"])) with { DietaryConsent = true }, newVersion);

        guestEdit.Response.StatusCode.ShouldBe(StatusCodes.Status200OK);
        Stored(harness).DietaryConsentSource.ShouldBe(DietaryConsentSource.Guest);
        Stored(harness).DietaryConsentAt.ShouldBe(harness.Time.GetUtcNow());
    }

    [Fact]
    public void AddsOrChangesComparesPeopleById()
    {
        RsvpPerson P(string id, string name, string? note = null, params string[] tags) => new(id, name, tags, note);
        RsvpAnswer A(params RsvpPerson[] people) => new(true, people, null, "es");
        var stored = A(P("p1", "Pablo Pérez", "Sin nueces", DietaryTags.Vegetarian, DietaryTags.GlutenFree), P("p2", "María-José García"));

        AdminDietaryConsent.AddsOrChanges(stored, stored).ShouldBeFalse();
        AdminDietaryConsent.AddsOrChanges(stored, A(P("p1", "Pablo Pérez", null, DietaryTags.GlutenFree))).ShouldBeFalse("only removed");
        AdminDietaryConsent.AddsOrChanges(stored, A(P("p1", "Pablo"), P("p2", "María-José"))).ShouldBeFalse("renamed without dietary data");
        AdminDietaryConsent.AddsOrChanges(stored, A(P("p1", "Pablo", null, DietaryTags.GlutenFree))).ShouldBeTrue("renamed, keeps a tag");
        AdminDietaryConsent.AddsOrChanges(stored, A(P("p1", "pablo pérez", "Sin nueces"))).ShouldBeTrue("renamed (only the case), keeps the note");
        AdminDietaryConsent.AddsOrChanges(stored, A(P("p2", "María-José García"), P("p1", "Pablo Pérez", "Sin nueces", DietaryTags.Vegetarian))).ShouldBeFalse("reordered");
        AdminDietaryConsent.AddsOrChanges(stored, A(P("p1", "Pablo Pérez", "Sin nueces", DietaryTags.Vegan))).ShouldBeTrue("a new tag");
        AdminDietaryConsent.AddsOrChanges(stored, A(P("p1", "Pablo Pérez", "sin nueces"))).ShouldBeTrue("a changed note");
        AdminDietaryConsent.AddsOrChanges(stored, A(P("p1", "Pablo Pérez"), P("p2", "María-José García", null, DietaryTags.Vegan))).ShouldBeTrue("moved to another person");
        AdminDietaryConsent.AddsOrChanges(stored, A(P("n1", "Pablo Pérez", "Sin nueces", DietaryTags.Vegetarian))).ShouldBeTrue("a person with a new id");
    }

    private static UpdateBody Reply(params PersonBody[] people) => new(true, people, null, "es", null);

    private static PersonBody Person(string name, string? id = null, string[]? tags = null, string? note = null) =>
        new(id, name, new DietaryBody(tags ?? [], note));

    private static RsvpRecord Stored(RsvpHarness harness) => harness.Memory.Items.ShouldHaveSingleItem().Record;

    private static async Task<(string Id, string Version, string[] PersonIds)> First(RsvpHarness harness)
    {
        var rsvp = TestHttp.ReadJson(await harness.AdminListAsync()).GetProperty("rsvps")[0];
        return (
            rsvp.GetProperty("id").GetString().ShouldNotBeNull(),
            rsvp.GetProperty("version").GetString().ShouldNotBeNull(),
            rsvp.GetProperty("people").EnumerateArray().Select(person => person.GetProperty("id").GetString().ShouldNotBeNull()).ToArray());
    }

    private static List<string> Errors(HttpContext httpContext)
    {
        httpContext.Response.StatusCode.ShouldBe(StatusCodes.Status400BadRequest);
        var problem = TestHttp.ReadJson(httpContext);
        problem.GetProperty("code").GetString().ShouldBe("validation_failed");
        return problem.GetProperty("errors").EnumerateArray()
            .Select(error => $"{error.GetProperty("field").GetString()}:{error.GetProperty("code").GetString()}")
            .ToList();
    }

    /// <summary>The body of an admin or guest update (camelCase on the wire; nulls omitted).</summary>
    private sealed record UpdateBody(bool Attending, PersonBody[] People, string? Message, string Language, bool? DietaryConsent);

    private sealed record PersonBody(string? Id, string Name, DietaryBody Dietary);

    private sealed record DietaryBody(string[] Tags, string? Note);
}
