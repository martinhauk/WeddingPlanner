using Azure;

using Microsoft.Extensions.Logging;

using WeddingPlanner.Api.Storage.Rsvps;

namespace WeddingPlanner.Api.Features.Rsvp;

/// <summary>
/// Computes the RSVP status and keeps it in memory for <see cref="Lifetime"/>, so the RSVP page costs at most one
/// storage query (the reply count) per minute and worker instance. A failed count (an HTTP error, or a network
/// failure or timeout once the storage client has used up its retries) is not cached and reports
/// <c>full: false</c>; the create endpoint checks the cap itself. The failure is logged by exception type and
/// status only, at most once per hour (<see cref="RsvpLogThrottle"/>).
/// </summary>
public sealed partial class RsvpStatusCache(
    IRsvpRepository repository,
    RsvpSettings settings,
    RsvpLogThrottle logThrottle,
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
            catch (Exception exception) when (IsStorageFailure(exception, cancellationToken))
            {
                if (logThrottle.ShouldLogCountFailed())
                {
                    // Never the message: storage errors carry host names.
                    LogCountFailed(logger, exception.GetType().FullName, (exception as RequestFailedException)?.Status ?? 0);
                }

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

    /// <summary>
    /// The failures the storage client reports: <see cref="RequestFailedException"/> for an HTTP error (or a transport
    /// error on the last try), <see cref="AggregateException"/> once retries after network failures are used up, and
    /// a cancellation that the caller did not ask for (the client's network timeout). A cancelled request still
    /// propagates.
    /// </summary>
    private static bool IsStorageFailure(Exception exception, CancellationToken cancellationToken) => exception switch
    {
        RequestFailedException or AggregateException => true,
        OperationCanceledException => !cancellationToken.IsCancellationRequested,
        _ => false,
    };

    [LoggerMessage(Level = LogLevel.Warning, Message = "Counting RSVP replies for the status failed ({ExceptionType}, HTTP {Status}); logged at most once per hour.")]
    private static partial void LogCountFailed(ILogger logger, string? exceptionType, int status);

    private sealed record Entry(RsvpStatusResponse Status, DateTimeOffset ExpiresAt);
}
