using Azure;

using Microsoft.Extensions.Logging;

using WeddingPlanner.Api.Storage.Rsvps;

namespace WeddingPlanner.Api.Features.Rsvp;

/// <summary>
/// Computes the RSVP status and keeps it in memory for <see cref="Lifetime"/>, so the RSVP page costs at most one
/// storage query (the reply count) per minute and worker instance. A failed count is not cached and reports
/// <c>full: false</c>; the create endpoint checks the cap itself.
/// </summary>
public sealed partial class RsvpStatusCache(
    IRsvpRepository repository,
    RsvpSettings settings,
    TimeProvider timeProvider,
    ILogger<RsvpStatusCache> logger)
{
    /// <summary>How long a computed status is reused.</summary>
    public static readonly TimeSpan Lifetime = TimeSpan.FromSeconds(60);

    private Entry? _entry;

    /// <summary>Returns the cached status, computing it when missing or older than <see cref="Lifetime"/>.</summary>
    public async Task<RsvpStatusResponse> GetAsync(CancellationToken cancellationToken)
    {
        var now = timeProvider.GetUtcNow();
        if (Volatile.Read(ref _entry) is { } cached && now < cached.ExpiresAt)
        {
            return cached.Status;
        }

        var deadline = settings.Deadline;
        var enabled = repository.IsConfigured && deadline is not null;
        var full = false;
        var cacheable = true;
        if (enabled)
        {
            try
            {
                full = await repository.CountAsync(cancellationToken) >= settings.MaxActiveRsvps;
            }
            catch (RequestFailedException exception)
            {
                LogCountFailed(logger, exception.Status);
                cacheable = false;
            }
        }

        var open = enabled && deadline is not null && deadline.IsOpenAt(now) && !full;
        var status = new RsvpStatusResponse(enabled, open, full, deadline?.Utc.UtcDateTime, settings.TimeZoneId, RsvpLimitsView.From(settings.Limits));
        if (cacheable)
        {
            Volatile.Write(ref _entry, new Entry(status, now + Lifetime));
        }

        return status;
    }

    [LoggerMessage(Level = LogLevel.Warning, Message = "Counting RSVP replies for the status failed with HTTP {Status}.")]
    private static partial void LogCountFailed(ILogger logger, int status);

    private sealed record Entry(RsvpStatusResponse Status, DateTimeOffset ExpiresAt);
}
