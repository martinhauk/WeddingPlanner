using WeddingPlanner.Domain.Rsvp;

namespace WeddingPlanner.Api.Features.Rsvp;

/// <summary>
/// RSVP settings, bound leniently from the <c>Rsvp</c> section: a malformed or out-of-range number keeps its
/// default. <c>Rsvp__Deadline</c> and <c>Rsvp__TimeZone</c> come from <c>instance.json</c> via Bicep; without a valid
/// deadline the RSVP endpoints answer 503 <c>not_configured</c> (reads of an existing reply still work).
/// </summary>
public sealed class RsvpOptions
{
    /// <summary>Configuration section.</summary>
    public const string SectionName = "Rsvp";

    /// <summary>Default of <see cref="MaxActiveRsvps"/>.</summary>
    public const int DefaultMaxActiveRsvps = 300;

    /// <summary>Default of <see cref="CookieLifetimeDays"/>.</summary>
    public const int DefaultCookieLifetimeDays = 365;

    /// <summary><c>Rsvp__Deadline</c>: ISO 8601 date-time, with offset or local to <see cref="TimeZone"/>. Default: none.</summary>
    public string? Deadline { get; set; }

    /// <summary><c>Rsvp__TimeZone</c>: IANA time zone of the deadline. Default <c>UTC</c>.</summary>
    public string TimeZone { get; set; } = RsvpDeadline.DefaultTimeZoneId;

    /// <summary><c>Rsvp__MaxCompanions</c>: 0 to 5 companions per reply. Default 5.</summary>
    public int MaxCompanions { get; set; } = RsvpLimits.MaxCompanionsCeiling;

    /// <summary><c>Rsvp__MaxActiveRsvps</c>: hard cap on stored replies; creating more answers 503. Default 300.</summary>
    public int MaxActiveRsvps { get; set; } = DefaultMaxActiveRsvps;

    /// <summary><c>Rsvp__CookieLifetimeDays</c>: <c>Max-Age</c> of the RSVP cookies, 1 to 400 days. Default 365.</summary>
    public int CookieLifetimeDays { get; set; } = DefaultCookieLifetimeDays;
}
