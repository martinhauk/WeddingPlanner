using Azure.Data.Tables;

using Microsoft.AspNetCore.Http;

using Shouldly;

using WeddingPlanner.Api.Storage.Rsvps;
using WeddingPlanner.Api.Tests.Support;

using Xunit;

namespace WeddingPlanner.Api.Tests.Integration;

/// <summary>The RSVP functions end to end on Azurite: create, read, update, delete, and what ends up in the table.</summary>
[Trait("Category", "Integration")]
public sealed class RsvpApiIntegrationTests
{
    [Fact]
    public async Task ARepliesLifecycleOnTableStorage()
    {
        await using var store = new AzuriteRsvpStore();
        using var harness = new RsvpHarness(store.Repository);
        await Azurite.CallAsync(() => store.Repository.CountAsync(TestContext.Current.CancellationToken));

        var created = await harness.PostAsync();
        created.Response.StatusCode.ShouldBe(StatusCodes.Status201Created);
        var cookie = TestHttp.CookieHeader(created);
        var token = cookie.Split("; ")[0].Split('.')[1];

        var read = await harness.GetMineAsync(cookie);
        read.Response.StatusCode.ShouldBe(StatusCodes.Status200OK);
        var etag = read.Response.Headers.ETag.ToString();
        etag.ShouldBe(created.Response.Headers.ETag.ToString());

        var updated = await harness.PutMineAsync(cookie, RsvpHarness.SampleBody(attending: false), etag);
        updated.Response.StatusCode.ShouldBe(StatusCodes.Status200OK);
        (await harness.PutMineAsync(cookie, RsvpHarness.SampleBody(), etag)).Response.StatusCode.ShouldBe(StatusCodes.Status412PreconditionFailed);

        // The personal edit link opened in another browser: the claim sets the same cookies and shows the change.
        var editToken = RsvpHarness.EditToken(created);
        var claimed = await harness.ClaimAsync(editToken);
        claimed.Response.StatusCode.ShouldBe(StatusCodes.Status200OK);
        TestHttp.CookieHeader(claimed).ShouldBe(cookie.Replace("wp_rsvp_state=yes", "wp_rsvp_state=no", StringComparison.Ordinal));
        claimed.Response.Headers.ETag.ToString().ShouldBe(updated.Response.Headers.ETag.ToString());
        (await harness.ClaimAsync(editToken.Split('.')[0] + "." + new string('A', 43))).Response.StatusCode.ShouldBe(StatusCodes.Status404NotFound);

        var entities = await ReadAllAsync(store.Table);
        var entity = entities.ShouldHaveSingleItem();
        entity.GetBoolean("Attending").ShouldBe(false);
        entity.GetInt32("AttendingCount").ShouldBe(0);
        entity.Select(property => property.Value).OfType<string>().ShouldNotContain(value => value.Contains(token, StringComparison.Ordinal), "only the token hash is stored");
        entity.GetString("People").ShouldNotBeNull().ShouldNotContain("vegan", customMessage: "no dietary data for a no");

        var deleted = await harness.DeleteMineAsync(cookie, updated.Response.Headers.ETag.ToString());
        deleted.Response.StatusCode.ShouldBe(StatusCodes.Status204NoContent);
        (await ReadAllAsync(store.Table)).ShouldBeEmpty();
        (await harness.GetMineAsync(cookie)).Response.StatusCode.ShouldBe(StatusCodes.Status404NotFound);
        (await harness.ClaimAsync(editToken)).Response.StatusCode.ShouldBe(StatusCodes.Status404NotFound, "withdrawing invalidates the link");
    }

    [Fact]
    public async Task TheStatusCountsStoredReplies()
    {
        await using var store = new AzuriteRsvpStore();
        using var harness = new RsvpHarness(store.Repository, new Dictionary<string, string?> { ["Rsvp:MaxActiveRsvps"] = "1" });
        await Azurite.CallAsync(() => store.Repository.CountAsync(TestContext.Current.CancellationToken));
        (await harness.PostAsync()).Response.StatusCode.ShouldBe(StatusCodes.Status201Created);

        var status = TestHttp.ReadJson(await harness.GetStatusAsync());

        status.GetProperty("full").GetBoolean().ShouldBeTrue();
        (await harness.PostAsync()).Response.StatusCode.ShouldBe(StatusCodes.Status503ServiceUnavailable);
    }

    private static async Task<List<TableEntity>> ReadAllAsync(TableClient table)
    {
        var entities = new List<TableEntity>();
        await foreach (var entity in table.QueryAsync<TableEntity>(cancellationToken: TestContext.Current.CancellationToken))
        {
            entities.Add(entity);
        }

        return entities;
    }
}
