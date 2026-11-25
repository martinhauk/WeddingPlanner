using Azure;

using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;

using Shouldly;

using WeddingPlanner.Api.Features.Rsvp;
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

    public static TheoryData<string> StorageFailures => ["http", "retries", "timeout"];

    [Theory]
    [MemberData(nameof(StorageFailures))]
    public async Task AFailedCountReportsNotFullIsNotCachedAndIsLoggedOncePerHour(string failure)
    {
        using var harness = new RsvpHarness();
        harness.Memory.CountFailure = () => StorageFailure(failure);

        var httpContext = await harness.GetStatusAsync();
        await harness.GetStatusAsync();

        httpContext.Response.StatusCode.ShouldBe(StatusCodes.Status200OK);
        var status = TestHttp.ReadJson(httpContext);
        status.GetProperty("enabled").GetBoolean().ShouldBeTrue();
        status.GetProperty("open").GetBoolean().ShouldBeTrue();
        status.GetProperty("full").GetBoolean().ShouldBeFalse();
        harness.Memory.CountCalls.ShouldBe(2, "a failed count is not cached");
        var warnings = CountFailureWarnings(harness);
        warnings.ShouldHaveSingleItem().ShouldContain(StorageFailure(failure).GetType().FullName!);
        warnings.ShouldAllBe(record => !record.Contains("storage.example.com", StringComparison.Ordinal));

        harness.Time.Advance(TimeSpan.FromHours(1));
        await harness.GetStatusAsync();
        CountFailureWarnings(harness).Count.ShouldBe(2);
    }

    [Fact]
    public async Task ACancelledRequestIsNotTreatedAsAStorageFailure()
    {
        using var harness = new RsvpHarness();
        using var cancellation = new CancellationTokenSource();
        await cancellation.CancelAsync();
        harness.Memory.CountFailure = () => new OperationCanceledException(cancellation.Token);
        var cache = harness.Services.GetRequiredService<RsvpStatusCache>();

        await Should.ThrowAsync<OperationCanceledException>(() => cache.GetAsync(cancellation.Token));

        CountFailureWarnings(harness).ShouldBeEmpty();
    }

    [Fact]
    public async Task AnUnexpectedExceptionPropagates()
    {
        using var harness = new RsvpHarness();
        harness.Memory.CountFailure = () => new InvalidOperationException("bug");

        await Should.ThrowAsync<InvalidOperationException>(() => harness.GetStatusAsync());
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

    /// <summary>What the storage client throws: an HTTP error, retries used up after network failures, a network timeout.</summary>
    private static Exception StorageFailure(string failure) => failure switch
    {
        "http" => new RequestFailedException(503, "Service unavailable at storage.example.com"),
        "retries" => new AggregateException("Retry failed after 4 tries (storage.example.com).", new RequestFailedException("storage.example.com")),
        _ => new TaskCanceledException("The operation was cancelled because it exceeded the configured timeout (storage.example.com)."),
    };

    private static List<string> CountFailureWarnings(RsvpHarness harness) =>
        harness.Logs.Records.Where(record => record.Contains("Counting RSVP replies", StringComparison.Ordinal)).ToList();
}
