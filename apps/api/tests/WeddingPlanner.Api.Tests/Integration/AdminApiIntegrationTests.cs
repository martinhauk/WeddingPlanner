using System.Text;

using Azure.Data.Tables;

using Microsoft.AspNetCore.Http;

using Shouldly;

using WeddingPlanner.Api.Tests.Support;

using Xunit;

namespace WeddingPlanner.Api.Tests.Integration;

/// <summary>The admin functions end to end on Azurite: list with totals, edit, delete and the CSV export.</summary>
[Trait("Category", "Integration")]
public sealed class AdminApiIntegrationTests
{
    [Fact]
    public async Task AdminsListEditDeleteAndExportRepliesOnTableStorage()
    {
        await using var store = new AzuriteRsvpStore();
        using var harness = new RsvpHarness(store.Repository);
        await Azurite.CallAsync(() => store.Repository.CountAsync(TestContext.Current.CancellationToken));

        (await harness.PostAsync()).Response.StatusCode.ShouldBe(StatusCodes.Status201Created);
        harness.Time.Advance(TimeSpan.FromMinutes(1));
        var declined = new { attending = false, people = new[] { new { name = "=1+1" }, new { name = "Jürgen Müller" } }, language = "de", website = string.Empty };
        (await harness.PostAsync(declined)).Response.StatusCode.ShouldBe(StatusCodes.Status201Created);

        var list = TestHttp.ReadJson(await harness.AdminListAsync());
        list.GetProperty("totals").GetProperty("attendingPeople").GetInt32().ShouldBe(2);
        list.GetProperty("totals").GetProperty("declinedPeople").GetInt32().ShouldBe(2);
        var latest = list.GetProperty("rsvps")[0];
        latest.GetProperty("attending").GetBoolean().ShouldBeFalse();
        var id = latest.GetProperty("id").GetString().ShouldNotBeNull();
        var version = latest.GetProperty("version").GetString().ShouldNotBeNull();

        var csv = await harness.AdminExportAsync();
        csv.Response.StatusCode.ShouldBe(StatusCodes.Status200OK);
        var bytes = AdminCalls.ReadBytes(csv);
        bytes.Take(3).ShouldBe(new byte[] { 0xEF, 0xBB, 0xBF });
        var lines = Encoding.UTF8.GetString(bytes, 3, bytes.Length - 3).Split("\r\n");
        lines.Length.ShouldBe(6, "header, four people, trailing line end");
        lines.ShouldContain(line => line.Contains("\"nein\";\"1\";\"'=1+1\"", StringComparison.Ordinal), "a formula name is neutralised");

        var accepted = new { attending = true, people = new[] { new { name = "Jürgen Müller", dietary = new { tags = new[] { "vegan" } } } }, language = "de", website = string.Empty };
        var updated = await harness.AdminPutAsync(id, accepted, version);
        updated.Response.StatusCode.ShouldBe(StatusCodes.Status200OK);
        var newVersion = TestHttp.ReadJson(updated).GetProperty("rsvp").GetProperty("version").GetString().ShouldNotBeNull();
        newVersion.ShouldNotBe(version);
        (await harness.AdminPutAsync(id, accepted, version)).Response.StatusCode.ShouldBe(StatusCodes.Status412PreconditionFailed);

        var stored = await store.Table.GetEntityAsync<TableEntity>("rsvp", id, cancellationToken: TestContext.Current.CancellationToken);
        stored.Value.GetBoolean("Attending").ShouldBe(true);
        stored.Value.GetInt32("AttendingCount").ShouldBe(1);

        (await harness.AdminDeleteAsync(id, version)).Response.StatusCode.ShouldBe(StatusCodes.Status412PreconditionFailed);
        (await harness.AdminDeleteAsync(id, newVersion)).Response.StatusCode.ShouldBe(StatusCodes.Status204NoContent);
        (await store.Repository.ListAsync(TestContext.Current.CancellationToken)).ShouldHaveSingleItem().Record.Answer.Attending.ShouldBeTrue();
    }
}
