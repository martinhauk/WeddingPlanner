namespace WeddingPlanner.Api.Features.Rsvp;

/// <summary>
/// Lets each recurring RSVP warning through at most once per <see cref="Interval"/> and worker instance
/// (singleton). Refused requests are never logged one by one (<c>docs/cost-and-abuse.md</c>, Log Analytics row):
/// spam that keeps posting at the cap, or a storage outage under load, would otherwise write a warning per request
/// and could use up the daily Application Insights cap, leaving the environment without monitoring.
/// </summary>
public sealed class RsvpLogThrottle(TimeProvider timeProvider)
{
    /// <summary>Minimum time between two records of the same warning.</summary>
    public static readonly TimeSpan Interval = TimeSpan.FromHours(1);

    private long _capacityReachedNextTicks = long.MinValue;
    private long _countFailedNextTicks = long.MinValue;

    /// <summary>Whether the "capacity reached" warning may be written now; claims the slot when it may.</summary>
    public bool ShouldLogCapacityReached() => TryClaim(ref _capacityReachedNextTicks);

    /// <summary>Whether the "counting replies failed" warning may be written now; claims the slot when it may.</summary>
    public bool ShouldLogCountFailed() => TryClaim(ref _countFailedNextTicks);

    private bool TryClaim(ref long nextTicks)
    {
        var now = timeProvider.GetUtcNow().UtcTicks;
        var next = Interlocked.Read(ref nextTicks);

        // Only one of several concurrent callers wins the compare-exchange, so a burst still yields one record.
        return now >= next && Interlocked.CompareExchange(ref nextTicks, now + Interval.Ticks, next) == next;
    }
}
