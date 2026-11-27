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
    private long _rejectionsNextTicks = long.MinValue;
    private long _rejectedHoneypot;
    private long _rejectedFillTime;
    private long _rejectedNameRules;

    /// <summary>Whether the "capacity reached" warning may be written now; claims the slot when it may.</summary>
    public bool ShouldLogCapacityReached() => TryClaim(ref _capacityReachedNextTicks);

    /// <summary>Whether the "counting replies failed" warning may be written now; claims the slot when it may.</summary>
    public bool ShouldLogCountFailed() => TryClaim(ref _countFailedNextTicks);

    /// <summary>
    /// Counts one refused new reply. When the hourly report is due, returns the counts since the last report (this
    /// refusal included) and starts counting anew; otherwise <see langword="null"/>.
    /// </summary>
    public RsvpRejectionCounts? CountRejection(RsvpRejectionReason reason)
    {
        Interlocked.Increment(ref Counter(reason));
        if (!TryClaim(ref _rejectionsNextTicks))
        {
            return null;
        }

        // A refusal counted between two of these exchanges lands in this report or the next one; none is lost.
        return new RsvpRejectionCounts(
            Interlocked.Exchange(ref _rejectedHoneypot, 0),
            Interlocked.Exchange(ref _rejectedFillTime, 0),
            Interlocked.Exchange(ref _rejectedNameRules, 0));
    }

    private ref long Counter(RsvpRejectionReason reason)
    {
        switch (reason)
        {
            case RsvpRejectionReason.Honeypot:
                return ref _rejectedHoneypot;
            case RsvpRejectionReason.FillTime:
                return ref _rejectedFillTime;
            case RsvpRejectionReason.NameRules:
                return ref _rejectedNameRules;
            default:
                throw new ArgumentOutOfRangeException(nameof(reason), reason, null);
        }
    }

    private bool TryClaim(ref long nextTicks)
    {
        var now = timeProvider.GetUtcNow().UtcTicks;
        var next = Interlocked.Read(ref nextTicks);

        // Only one of several concurrent callers wins the compare-exchange, so a burst still yields one record.
        return now >= next && Interlocked.CompareExchange(ref nextTicks, now + Interval.Ticks, next) == next;
    }
}

/// <summary>Why a new reply was refused as automated or as junk; only counted, never told to the caller.</summary>
public enum RsvpRejectionReason
{
    /// <summary>The hidden <c>website</c> field was filled in (400 <c>submission_rejected</c>).</summary>
    Honeypot,

    /// <summary>Sent faster than the minimum fill time, or without <c>elapsedMs</c> (400 <c>submission_rejected</c>).</summary>
    FillTime,

    /// <summary>A name broke the name rules: too short, no letter, a web address or <c>@</c> (400 <c>validation_failed</c>).</summary>
    NameRules,
}

/// <summary>Refused new replies per reason since the last report.</summary>
public readonly record struct RsvpRejectionCounts(long Honeypot, long FillTime, long NameRules)
{
    /// <summary>All refusals.</summary>
    public long Total => Honeypot + FillTime + NameRules;
}
