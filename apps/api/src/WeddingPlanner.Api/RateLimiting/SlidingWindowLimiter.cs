namespace WeddingPlanner.Api.RateLimiting;

/// <summary>
/// In-memory sliding-window log: at most <c>permitLimit</c> permits per key within any <c>window</c>. State lives
/// in the worker instance only (scale-out multiplies the limits; a restart resets them), which is enough to stop
/// a single client from hammering the API before any storage I/O.
/// </summary>
/// <remarks>
/// Memory is bounded: idle keys are pruned regularly, and when <c>maxKeys</c> distinct keys are active a new key
/// is refused (fail closed) instead of growing without limit.
/// </remarks>
public sealed class SlidingWindowLimiter
{
    private const int PruneEvery = 1024;

    private readonly int _permitLimit;
    private readonly TimeSpan _window;
    private readonly TimeProvider _timeProvider;
    private readonly int _maxKeys;
    private readonly Lock _gate = new();
    private readonly Dictionary<string, LinkedList<DateTimeOffset>> _permits = new(StringComparer.Ordinal);
    private int _callsSincePrune;

    /// <summary>Creates a limiter.</summary>
    public SlidingWindowLimiter(int permitLimit, TimeSpan window, TimeProvider timeProvider, int maxKeys = 10_000)
    {
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(permitLimit);
        ArgumentOutOfRangeException.ThrowIfLessThanOrEqual(window, TimeSpan.Zero);
        ArgumentNullException.ThrowIfNull(timeProvider);
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(maxKeys);

        _permitLimit = permitLimit;
        _window = window;
        _timeProvider = timeProvider;
        _maxKeys = maxKeys;
    }

    /// <summary>Number of keys currently tracked (for tests).</summary>
    public int KeyCount
    {
        get
        {
            lock (_gate)
            {
                return _permits.Count;
            }
        }
    }

    /// <summary>
    /// Takes a permit for <paramref name="key"/>. On refusal, <paramref name="retryAfter"/> is the time until the
    /// oldest permit in the window expires (at least one second).
    /// </summary>
    public bool TryAcquire(string key, out TimeSpan retryAfter)
    {
        ArgumentNullException.ThrowIfNull(key);

        var now = _timeProvider.GetUtcNow();
        lock (_gate)
        {
            if (++_callsSincePrune >= PruneEvery)
            {
                Prune(now);
            }

            if (!_permits.TryGetValue(key, out var permits))
            {
                if (_permits.Count >= _maxKeys)
                {
                    Prune(now);
                }

                if (_permits.Count >= _maxKeys)
                {
                    retryAfter = _window;
                    return false;
                }

                permits = new LinkedList<DateTimeOffset>();
                _permits[key] = permits;
            }

            while (permits.First is { } oldest && oldest.Value <= now - _window)
            {
                permits.RemoveFirst();
            }

            if (permits.Count >= _permitLimit)
            {
                var wait = permits.First!.Value + _window - now;
                retryAfter = wait < TimeSpan.FromSeconds(1) ? TimeSpan.FromSeconds(1) : wait;
                return false;
            }

            permits.AddLast(now);
            retryAfter = TimeSpan.Zero;
            return true;
        }
    }

    /// <summary>
    /// Gives back the newest permit of <paramref name="key"/>, for a request that a later check refused after
    /// <see cref="TryAcquire"/> succeeded, and forgets the key once it holds no permit.
    /// </summary>
    public void Release(string key)
    {
        ArgumentNullException.ThrowIfNull(key);

        lock (_gate)
        {
            if (!_permits.TryGetValue(key, out var permits))
            {
                return;
            }

            if (permits.Count > 0)
            {
                permits.RemoveLast();
            }

            if (permits.Count == 0)
            {
                _permits.Remove(key);
            }
        }
    }

    private void Prune(DateTimeOffset now)
    {
        _callsSincePrune = 0;
        var cutoff = now - _window;
        foreach (var (key, permits) in _permits)
        {
            if (permits.Last is not { } newest || newest.Value <= cutoff)
            {
                _permits.Remove(key);
            }
        }
    }
}
