using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

using WeddingPlanner.Domain.Rsvp;

namespace WeddingPlanner.Api.Features.Rsvp;

/// <summary>The resolved RSVP configuration (singleton): parsed deadline, limits and cookie lifetime.</summary>
public sealed partial class RsvpSettings
{
    public RsvpSettings(IOptions<RsvpOptions> options, ILogger<RsvpSettings> logger)
    {
        ArgumentNullException.ThrowIfNull(options);
        ArgumentNullException.ThrowIfNull(logger);

        var settings = options.Value;
        Limits = new RsvpLimits(settings.MaxCompanions);
        MaxActiveRsvps = settings.MaxActiveRsvps;
        CookieLifetime = TimeSpan.FromDays(settings.CookieLifetimeDays);

        if (RsvpDeadline.TryCreate(settings.Deadline, settings.TimeZone, out var deadline))
        {
            Deadline = deadline;
        }
        else
        {
            // The values come from instance.json and are not personal data, but stay out of the logs anyway.
            LogDeadlineNotConfigured(logger);
        }
    }

    /// <summary>The deadline, or <see langword="null"/> when <c>Rsvp__Deadline</c> / <c>Rsvp__TimeZone</c> are missing or invalid.</summary>
    public RsvpDeadline? Deadline { get; }

    /// <summary>Size limits of one reply.</summary>
    public RsvpLimits Limits { get; }

    /// <summary>Cap on stored replies.</summary>
    public int MaxActiveRsvps { get; }

    /// <summary><c>Max-Age</c> of the RSVP cookies.</summary>
    public TimeSpan CookieLifetime { get; }

    /// <summary>The time zone the deadline is shown in.</summary>
    public string TimeZoneId => Deadline?.TimeZoneId ?? RsvpDeadline.DefaultTimeZoneId;

    [LoggerMessage(Level = LogLevel.Warning, Message = "RSVP is not configured: Rsvp__Deadline or Rsvp__TimeZone is missing or invalid.")]
    private static partial void LogDeadlineNotConfigured(ILogger logger);
}
