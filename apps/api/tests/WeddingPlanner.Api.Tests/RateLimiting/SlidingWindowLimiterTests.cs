using Microsoft.Extensions.Time.Testing;

using Shouldly;

using WeddingPlanner.Api.RateLimiting;

using Xunit;

namespace WeddingPlanner.Api.Tests.RateLimiting;

public sealed class SlidingWindowLimiterTests
{
    private readonly FakeTimeProvider _time = new(new DateTimeOffset(2099, 4, 1, 10, 0, 0, TimeSpan.Zero));

    [Fact]
    public void AllowsTheLimitWithinTheWindowThenRefuses()
    {
        var limiter = new SlidingWindowLimiter(3, TimeSpan.FromMinutes(10), _time);

        for (var index = 0; index < 3; index++)
        {
            limiter.TryAcquire("a", out _).ShouldBeTrue();
            _time.Advance(TimeSpan.FromMinutes(1));
        }

        limiter.TryAcquire("a", out var retryAfter).ShouldBeFalse();
        retryAfter.ShouldBe(TimeSpan.FromMinutes(7), "the oldest permit expires 10 minutes after it was taken");
    }

    [Fact]
    public void TheWindowSlides()
    {
        var limiter = new SlidingWindowLimiter(2, TimeSpan.FromMinutes(10), _time);
        limiter.TryAcquire("a", out _).ShouldBeTrue();
        _time.Advance(TimeSpan.FromMinutes(5));
        limiter.TryAcquire("a", out _).ShouldBeTrue();
        limiter.TryAcquire("a", out _).ShouldBeFalse();

        _time.Advance(TimeSpan.FromMinutes(5));

        limiter.TryAcquire("a", out _).ShouldBeTrue("the first permit has left the window");
        limiter.TryAcquire("a", out _).ShouldBeFalse();
    }

    [Fact]
    public void ReleaseGivesBackTheNewestPermit()
    {
        var limiter = new SlidingWindowLimiter(2, TimeSpan.FromMinutes(10), _time);
        limiter.TryAcquire("a", out _).ShouldBeTrue();
        _time.Advance(TimeSpan.FromMinutes(5));
        limiter.TryAcquire("a", out _).ShouldBeTrue();

        limiter.Release("a");

        limiter.TryAcquire("a", out _).ShouldBeTrue();
        limiter.TryAcquire("a", out var retryAfter).ShouldBeFalse();
        retryAfter.ShouldBe(TimeSpan.FromMinutes(5), "the oldest permit was kept");
    }

    [Fact]
    public void ReleaseForgetsAKeyWithoutPermits()
    {
        var limiter = new SlidingWindowLimiter(2, TimeSpan.FromMinutes(10), _time);
        limiter.TryAcquire("a", out _).ShouldBeTrue();
        limiter.TryAcquire("b", out _).ShouldBeTrue();

        limiter.Release("b");
        limiter.Release("unknown");

        limiter.KeyCount.ShouldBe(1);
    }

    [Fact]
    public void KeysAreIndependent()
    {
        var limiter = new SlidingWindowLimiter(1, TimeSpan.FromMinutes(1), _time);

        limiter.TryAcquire("a", out _).ShouldBeTrue();
        limiter.TryAcquire("b", out _).ShouldBeTrue();
        limiter.TryAcquire("a", out _).ShouldBeFalse();
    }

    [Fact]
    public void RetryAfterIsAtLeastOneSecond()
    {
        var limiter = new SlidingWindowLimiter(1, TimeSpan.FromMinutes(1), _time);
        limiter.TryAcquire("a", out _).ShouldBeTrue();
        _time.Advance(TimeSpan.FromSeconds(59.9));

        limiter.TryAcquire("a", out var retryAfter).ShouldBeFalse();

        retryAfter.ShouldBe(TimeSpan.FromSeconds(1));
    }

    [Fact]
    public void RefusesNewKeysWhileFullAndPrunesIdleOnes()
    {
        var limiter = new SlidingWindowLimiter(5, TimeSpan.FromMinutes(1), _time, maxKeys: 2);
        limiter.TryAcquire("a", out _).ShouldBeTrue();
        limiter.TryAcquire("b", out _).ShouldBeTrue();

        limiter.TryAcquire("c", out var retryAfter).ShouldBeFalse("memory stays bounded");
        retryAfter.ShouldBe(TimeSpan.FromMinutes(1));
        limiter.TryAcquire("a", out _).ShouldBeTrue("known keys keep working");

        _time.Advance(TimeSpan.FromMinutes(1));

        limiter.TryAcquire("c", out _).ShouldBeTrue("idle keys were pruned");
        limiter.KeyCount.ShouldBe(1);
    }
}
