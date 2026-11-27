using Microsoft.Extensions.Time.Testing;

using Shouldly;

using WeddingPlanner.Api.Features.Rsvp;

using Xunit;

namespace WeddingPlanner.Api.Tests.Rsvp;

public sealed class RsvpLogThrottleTests
{
    private readonly FakeTimeProvider _time = new(new DateTimeOffset(2099, 4, 1, 10, 0, 0, TimeSpan.Zero));

    [Fact]
    public void LetsEachWarningThroughOncePerHour()
    {
        var throttle = new RsvpLogThrottle(_time);

        throttle.ShouldLogCapacityReached().ShouldBeTrue();
        throttle.ShouldLogCapacityReached().ShouldBeFalse();
        throttle.ShouldLogCountFailed().ShouldBeTrue("each warning has its own slot");

        _time.Advance(RsvpLogThrottle.Interval - TimeSpan.FromTicks(1));
        throttle.ShouldLogCapacityReached().ShouldBeFalse();

        _time.Advance(TimeSpan.FromTicks(1));
        throttle.ShouldLogCapacityReached().ShouldBeTrue();
        throttle.ShouldLogCapacityReached().ShouldBeFalse();
    }

    [Fact]
    public void ReportsRefusedRepliesOncePerHourWithTheCountsSinceTheLastReport()
    {
        var throttle = new RsvpLogThrottle(_time);

        throttle.CountRejection(RsvpRejectionReason.FillTime).ShouldBe(new RsvpRejectionCounts(0, 1, 0), "the first refusal is reported at once");
        throttle.CountRejection(RsvpRejectionReason.Honeypot).ShouldBeNull();
        throttle.CountRejection(RsvpRejectionReason.Honeypot).ShouldBeNull();
        throttle.CountRejection(RsvpRejectionReason.NameRules).ShouldBeNull();
        throttle.ShouldLogCapacityReached().ShouldBeTrue("the report has its own slot");

        _time.Advance(RsvpLogThrottle.Interval - TimeSpan.FromTicks(1));
        throttle.CountRejection(RsvpRejectionReason.FillTime).ShouldBeNull();

        _time.Advance(TimeSpan.FromTicks(1));
        var report = throttle.CountRejection(RsvpRejectionReason.NameRules).ShouldNotBeNull();
        report.ShouldBe(new RsvpRejectionCounts(2, 1, 2));
        report.Total.ShouldBe(5);

        _time.Advance(RsvpLogThrottle.Interval);
        throttle.CountRejection(RsvpRejectionReason.Honeypot).ShouldBe(new RsvpRejectionCounts(1, 0, 0), "the counts start anew after a report");
    }

    [Fact]
    public async Task ConcurrentRefusalsAreAllCountedOnce()
    {
        var throttle = new RsvpLogThrottle(_time);
        using var start = new ManualResetEventSlim();

        var callers = Enumerable.Range(0, 64).Select(index => Task.Run(() =>
        {
            start.Wait(TestContext.Current.CancellationToken);
            return throttle.CountRejection((RsvpRejectionReason)(index % 3));
        })).ToList();
        start.Set();
        var reports = (await Task.WhenAll(callers)).OfType<RsvpRejectionCounts>().ToList();
        _time.Advance(RsvpLogThrottle.Interval);
        reports.Add(throttle.CountRejection(RsvpRejectionReason.Honeypot).ShouldNotBeNull());

        reports.Count.ShouldBe(2, "one report per hour");
        reports.Sum(report => report.Total).ShouldBe(65);
    }

    [Fact]
    public async Task ABurstOfConcurrentCallersYieldsOneRecord()
    {
        var throttle = new RsvpLogThrottle(_time);
        using var start = new ManualResetEventSlim();

        var callers = Enumerable.Range(0, 32).Select(_ => Task.Run(() =>
        {
            start.Wait(TestContext.Current.CancellationToken);
            return throttle.ShouldLogCapacityReached();
        })).ToList();
        start.Set();
        var results = await Task.WhenAll(callers);

        results.Count(allowed => allowed).ShouldBe(1);
    }
}
