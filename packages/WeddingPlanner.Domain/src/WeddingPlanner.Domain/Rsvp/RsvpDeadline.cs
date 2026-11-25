using System.Diagnostics.CodeAnalysis;
using System.Globalization;
using System.Text.RegularExpressions;

namespace WeddingPlanner.Domain.Rsvp;

/// <summary>
/// The RSVP deadline: replies can be created, changed and deleted until and including this instant.
/// </summary>
/// <remarks>
/// Parsed from the app settings <c>Rsvp__Deadline</c> and <c>Rsvp__TimeZone</c>. The deadline is an ISO 8601 /
/// RFC 3339 date-time (<c>yyyy-MM-ddTHH:mm[:ss[.fffffff]]</c>); a space may replace the <c>T</c>. With a UTC offset or
/// <c>Z</c> it is taken as is; without one it is local time in the time zone. The time zone is an IANA id (for example
/// <c>Europe/Berlin</c>); it defaults to <c>UTC</c> and is also what the guest sees the deadline in.
/// <para>
/// The space form exists for <c>local.settings.json</c>: Azure Functions Core Tools reads that file with a JSON parser
/// that turns <c>T</c>-separated date strings into culture-formatted dates before the worker sees them, while a
/// space-separated value passes through unchanged. Azure app settings are passed verbatim, so both forms work there.
/// </para>
/// </remarks>
public sealed partial class RsvpDeadline
{
    /// <summary>Time zone used when none is configured.</summary>
    public const string DefaultTimeZoneId = "UTC";

    private static readonly string[] _localFormats =
    [
        "yyyy-MM-dd'T'HH:mm",
        "yyyy-MM-dd'T'HH:mm:ss",
        "yyyy-MM-dd'T'HH:mm:ss.FFFFFFF",
    ];

    private RsvpDeadline(DateTimeOffset utc, string timeZoneId)
    {
        Utc = utc;
        TimeZoneId = timeZoneId;
    }

    /// <summary>The deadline as a UTC instant.</summary>
    public DateTimeOffset Utc { get; }

    /// <summary>IANA id of the time zone the deadline is shown in.</summary>
    public string TimeZoneId { get; }

    /// <summary>
    /// Parses the configured deadline. Returns <see langword="false"/> for a missing or malformed deadline, an
    /// unknown time zone, or a local time that does not exist in the time zone (skipped by a DST change).
    /// </summary>
    public static bool TryCreate(string? deadline, string? timeZoneId, [NotNullWhen(true)] out RsvpDeadline? result)
    {
        result = null;
        var zoneId = string.IsNullOrWhiteSpace(timeZoneId) ? DefaultTimeZoneId : timeZoneId.Trim();
        if (!TimeZoneInfo.TryFindSystemTimeZoneById(zoneId, out var zone))
        {
            return false;
        }

        var trimmed = deadline?.Trim() ?? string.Empty;
        var match = DateTimeShape().Match(trimmed);
        if (!match.Success)
        {
            return false;
        }

        // Normalise the RFC 3339 space separator to 'T' so both forms parse the same way.
        var value = string.Concat(trimmed.AsSpan(0, 10), "T", trimmed.AsSpan(11));

        if (match.Groups["offset"].Success)
        {
            if (!DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.None, out var withOffset))
            {
                return false;
            }

            result = new RsvpDeadline(withOffset.ToUniversalTime(), zoneId);
            return true;
        }

        if (!DateTime.TryParseExact(value, _localFormats, CultureInfo.InvariantCulture, DateTimeStyles.None, out var local)
            || zone.IsInvalidTime(local))
        {
            return false;
        }

        // An ambiguous local time (repeated by a DST change) resolves to standard time, the later instant.
        var utc = TimeZoneInfo.ConvertTimeToUtc(DateTime.SpecifyKind(local, DateTimeKind.Unspecified), zone);
        result = new RsvpDeadline(new DateTimeOffset(utc, TimeSpan.Zero), zoneId);
        return true;
    }

    /// <summary>Whether replies may still be created, changed or deleted at <paramref name="now"/> (inclusive).</summary>
    public bool IsOpenAt(DateTimeOffset now) => now <= Utc;

    [GeneratedRegex(@"^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d{1,7})?)?(?<offset>Z|[+-]\d{2}:\d{2})?$", RegexOptions.CultureInvariant)]
    private static partial Regex DateTimeShape();
}
