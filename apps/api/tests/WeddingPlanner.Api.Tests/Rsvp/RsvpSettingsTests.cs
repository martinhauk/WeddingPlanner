using Microsoft.Extensions.DependencyInjection;

using Shouldly;

using WeddingPlanner.Api.Features.Rsvp;
using WeddingPlanner.Api.Tests.Support;

using Xunit;

namespace WeddingPlanner.Api.Tests.Rsvp;

public sealed class RsvpSettingsTests
{
    [Fact]
    public void ReadsTheAppSettingsBicepWrites()
    {
        // Bicep (infra/app/modules/static-web-app.bicep) sets Rsvp__Deadline and Rsvp__TimeZone from instance.json.
        var settings = Resolve(new() { ["Rsvp:Deadline"] = "2099-06-30T23:59:59", ["Rsvp:TimeZone"] = "Europe/Berlin" });

        settings.Deadline.ShouldNotBeNull().Utc.ShouldBe(new DateTimeOffset(2099, 6, 30, 21, 59, 59, TimeSpan.Zero));
        settings.TimeZoneId.ShouldBe("Europe/Berlin");
    }

    [Fact]
    public void HasCodeDefaults()
    {
        var settings = Resolve(new() { ["Rsvp:Deadline"] = null, ["Rsvp:TimeZone"] = null });

        settings.Deadline.ShouldBeNull();
        settings.TimeZoneId.ShouldBe("UTC");
        settings.Limits.MaxCompanions.ShouldBe(5);
        settings.Limits.MaxPeople.ShouldBe(6);
        settings.MaxActiveRsvps.ShouldBe(300);
        settings.CookieLifetime.ShouldBe(TimeSpan.FromDays(365));
        settings.MinSubmitTime.ShouldBe(TimeSpan.FromMilliseconds(2500));
    }

    [Theory]
    [InlineData("-1")]
    [InlineData("60001")]
    [InlineData("3s")]
    [InlineData("")]
    public void KeepsTheDefaultMinimumFillTimeForAnInvalidSetting(string value)
    {
        Resolve(new() { ["Rsvp:MinSubmitMs"] = value }).MinSubmitTime.ShouldBe(TimeSpan.FromMilliseconds(RsvpOptions.DefaultMinSubmitMs));
    }

    [Theory]
    [InlineData("0", 0)]
    [InlineData("4000", 4000)]
    [InlineData("60000", 60000)]
    public void ReadsTheMinimumFillTime(string value, int expectedMs)
    {
        Resolve(new() { ["Rsvp:MinSubmitMs"] = value }).MinSubmitTime.ShouldBe(TimeSpan.FromMilliseconds(expectedMs));
    }

    [Fact]
    public void KeepsDefaultsForMalformedOrOutOfRangeNumbers()
    {
        var settings = Resolve(new()
        {
            ["Rsvp:MaxCompanions"] = "9",
            ["Rsvp:MaxActiveRsvps"] = "many",
            ["Rsvp:CookieLifetimeDays"] = "401",
        });

        settings.Limits.MaxCompanions.ShouldBe(5);
        settings.MaxActiveRsvps.ShouldBe(300);
        settings.CookieLifetime.ShouldBe(TimeSpan.FromDays(365));
    }

    [Fact]
    public void AcceptsLowerLimits()
    {
        var settings = Resolve(new()
        {
            ["Rsvp:MaxCompanions"] = "0",
            ["Rsvp:MaxActiveRsvps"] = "150",
            ["Rsvp:CookieLifetimeDays"] = "30",
        });

        settings.Limits.MaxPeople.ShouldBe(1);
        settings.MaxActiveRsvps.ShouldBe(150);
        settings.CookieLifetime.ShouldBe(TimeSpan.FromDays(30));
    }

    [Fact]
    public void AnUnknownTimeZoneLeavesTheDeadlineUnconfigured()
    {
        Resolve(new() { ["Rsvp:TimeZone"] = "Atlantis/Capital" }).Deadline.ShouldBeNull();
    }

    private static RsvpSettings Resolve(Dictionary<string, string?> settings)
    {
        using var harness = new RsvpHarness(settings: settings);
        return harness.Services.GetRequiredService<RsvpSettings>();
    }
}
