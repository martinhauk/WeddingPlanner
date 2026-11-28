using Shouldly;

using WeddingPlanner.Domain.Rsvp;

using Xunit;

namespace WeddingPlanner.Domain.Tests.Rsvp;

public sealed class RsvpDeadlineTests
{
    [Fact]
    public void TakesADeadlineWithOffsetAsIs()
    {
        var deadline = Create("2099-07-01T23:59:00+02:00", "Europe/Berlin");

        deadline.Utc.ShouldBe(Utc(2099, 7, 1, 21, 59, 0));
        deadline.Utc.Offset.ShouldBe(TimeSpan.Zero);
        deadline.TimeZoneId.ShouldBe("Europe/Berlin");
    }

    [Fact]
    public void TakesZAsUtcAndDefaultsTheTimeZoneToUtc()
    {
        var deadline = Create("2099-06-30T12:00:00Z", timeZoneId: null);

        deadline.Utc.ShouldBe(Utc(2099, 6, 30, 12, 0, 0));
        deadline.TimeZoneId.ShouldBe(RsvpDeadline.DefaultTimeZoneId);
    }

    [Theory]
    [InlineData("2099-06-30T23:59:59", 2099, 6, 30, 21, 59, 59)]
    [InlineData("2099-01-10T23:59", 2099, 1, 10, 22, 59, 0)]
    public void InterpretsALocalDeadlineInTheTimeZone(string value, int year, int month, int day, int hour, int minute, int second)
    {
        Create(value, "Europe/Berlin").Utc.ShouldBe(Utc(year, month, day, hour, minute, second));
    }

    [Theory]
    [InlineData("2099-07-01 23:59:00+02:00")]
    [InlineData("2099-07-01 21:59Z")]
    [InlineData("2099-07-01 23:59")]
    public void AcceptsASpaceInsteadOfTheT(string value)
    {
        // The form for local.settings.json, which Core Tools would otherwise rewrite (see RsvpDeadline remarks).
        Create(value, "Europe/Berlin").Utc.ShouldBe(Utc(2099, 7, 1, 21, 59, 0));
    }

    [Fact]
    public void AcceptsFractionalSeconds()
    {
        Create("2099-06-30T23:59:59.5", "Europe/Berlin").Utc.ShouldBe(Utc(2099, 6, 30, 21, 59, 59).AddMilliseconds(500));
    }

    [Fact]
    public void ResolvesAnAmbiguousLocalTimeToStandardTime()
    {
        // 02:30 happens twice when Berlin leaves summer time; standard time (UTC+1) is the later instant.
        Create("2099-10-25T02:30", "Europe/Berlin").Utc.ShouldBe(Utc(2099, 10, 25, 1, 30, 0));
    }

    [Fact]
    public void RejectsALocalTimeSkippedBySummerTime()
    {
        RsvpDeadline.TryCreate("2099-03-29T02:30", "Europe/Berlin", out _).ShouldBeFalse();
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("tomorrow")]
    [InlineData("2099-06-30")]
    [InlineData("2099-06-30  23:59")]
    [InlineData("2099-06-30t23:59")]
    [InlineData("07/01/2099 21:59:00")]
    [InlineData("2099-02-30T10:00")]
    [InlineData("2099-06-30T24:00")]
    [InlineData("2099-06-30T23:59+0200")]
    [InlineData("30.06.2099 23:59")]
    public void RejectsMissingOrMalformedDeadlines(string? value)
    {
        RsvpDeadline.TryCreate(value, "Europe/Berlin", out var deadline).ShouldBeFalse();
        deadline.ShouldBeNull();
    }

    [Fact]
    public void RejectsAnUnknownTimeZone()
    {
        RsvpDeadline.TryCreate("2099-06-30T23:59:00+02:00", "Mars/Olympus_Mons", out _).ShouldBeFalse();
    }

    [Fact]
    public void IsOpenUntilAndIncludingTheDeadline()
    {
        var deadline = Create("2099-07-01T23:59:00+02:00", "Europe/Berlin");

        deadline.IsOpenAt(deadline.Utc.AddDays(-30)).ShouldBeTrue();
        deadline.IsOpenAt(deadline.Utc).ShouldBeTrue();
        deadline.IsOpenAt(deadline.Utc.AddTicks(1)).ShouldBeFalse();
    }

    private static RsvpDeadline Create(string value, string? timeZoneId)
    {
        RsvpDeadline.TryCreate(value, timeZoneId, out var deadline).ShouldBeTrue();
        return deadline.ShouldNotBeNull();
    }

    private static DateTimeOffset Utc(int year, int month, int day, int hour, int minute, int second) =>
        new(year, month, day, hour, minute, second, TimeSpan.Zero);
}
