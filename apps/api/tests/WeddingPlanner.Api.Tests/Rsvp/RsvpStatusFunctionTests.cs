using Microsoft.AspNetCore.Http;

using Shouldly;

using WeddingPlanner.Api.Tests.Support;

using Xunit;

namespace WeddingPlanner.Api.Tests.Rsvp;

public sealed class RsvpStatusFunctionTests
{
    [Fact]
    public async Task ReportsTheOpenStateDeadlineAndLimits()
    {
        using var harness = new RsvpHarness();

        var httpContext = await harness.GetStatusAsync();

        httpContext.Response.StatusCode.ShouldBe(StatusCodes.Status200OK);
        httpContext.Response.Headers.CacheControl.ToString().ShouldBe("public, max-age=60");
        TestHttp.SetCookies(httpContext).ShouldBeEmpty();
        var status = TestHttp.ReadJson(httpContext);
        status.EnumerateObject().Select(property => property.Name).ShouldBe(["enabled", "open", "full", "deadline", "timeZone", "limits"]);
        status.GetProperty("enabled").GetBoolean().ShouldBeTrue();
        status.GetProperty("open").GetBoolean().ShouldBeTrue();
        status.GetProperty("full").GetBoolean().ShouldBeFalse();
        status.GetProperty("deadline").GetString().ShouldBe("2099-05-01T21:59:00Z");
        status.GetProperty("timeZone").GetString().ShouldBe("Europe/Berlin");

        var limits = status.GetProperty("limits");
        limits.GetProperty("maxPeople").GetInt32().ShouldBe(6);
        limits.GetProperty("maxCompanions").GetInt32().ShouldBe(5);
        limits.GetProperty("maxNameLength").GetInt32().ShouldBe(80);
        limits.GetProperty("maxNoteLength").GetInt32().ShouldBe(200);
        limits.GetProperty("maxMessageLength").GetInt32().ShouldBe(1000);
        limits.GetProperty("dietaryTags").EnumerateArray().Select(tag => tag.GetString()).ShouldBe(["vegetarian", "vegan", "glutenFree", "lactoseFree"]);
    }

    [Fact]
    public async Task HonoursALowerCompanionLimit()
    {
        using var harness = new RsvpHarness(settings: new Dictionary<string, string?> { ["Rsvp:MaxCompanions"] = "2" });

        var limits = TestHttp.ReadJson(await harness.GetStatusAsync()).GetProperty("limits");

        limits.GetProperty("maxPeople").GetInt32().ShouldBe(3);
        limits.GetProperty("maxCompanions").GetInt32().ShouldBe(2);
    }

    [Fact]
    public async Task CachesTheStatusForSixtySeconds()
    {
        using var harness = new RsvpHarness();

        await harness.GetStatusAsync();
        harness.Time.Advance(TimeSpan.FromSeconds(59));
        await harness.GetStatusAsync();
        harness.Memory.CountCalls.ShouldBe(1);

        harness.Time.Advance(TimeSpan.FromSeconds(1));
        await harness.GetStatusAsync();
        harness.Memory.CountCalls.ShouldBe(2);
    }

    [Fact]
    public async Task IsClosedAfterTheDeadline()
    {
        using var harness = new RsvpHarness();
        harness.Time.SetUtcNow(RsvpHarness.DeadlineUtc.AddSeconds(1));

        var status = TestHttp.ReadJson(await harness.GetStatusAsync());

        status.GetProperty("enabled").GetBoolean().ShouldBeTrue();
        status.GetProperty("open").GetBoolean().ShouldBeFalse();
    }

    [Fact]
    public async Task IsClosedAndFullAtTheCap()
    {
        using var harness = new RsvpHarness(settings: new Dictionary<string, string?> { ["Rsvp:MaxActiveRsvps"] = "1" });
        await harness.PostAsync();

        var status = TestHttp.ReadJson(await harness.GetStatusAsync());

        status.GetProperty("full").GetBoolean().ShouldBeTrue();
        status.GetProperty("open").GetBoolean().ShouldBeFalse();
    }

    [Fact]
    public async Task IsDisabledWithoutConfigurationAndDoesNoStorageIo()
    {
        using var harness = new RsvpHarness(settings: new Dictionary<string, string?> { ["Rsvp:Deadline"] = null, ["Rsvp:TimeZone"] = null });

        var status = TestHttp.ReadJson(await harness.GetStatusAsync());

        status.GetProperty("enabled").GetBoolean().ShouldBeFalse();
        status.GetProperty("open").GetBoolean().ShouldBeFalse();
        status.TryGetProperty("deadline", out _).ShouldBeFalse();
        status.GetProperty("timeZone").GetString().ShouldBe("UTC");
        harness.Memory.Calls.ShouldBe(0);
    }
}
