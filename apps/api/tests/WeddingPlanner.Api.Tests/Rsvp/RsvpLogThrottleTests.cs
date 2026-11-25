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
