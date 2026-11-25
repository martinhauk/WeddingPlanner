using Microsoft.AspNetCore.Http;

using WeddingPlanner.Api.Http;
using WeddingPlanner.Api.Storage.Rsvps;
using WeddingPlanner.Domain.Rsvp;

namespace WeddingPlanner.Api.Features.Rsvp;

/// <summary>Shared pieces of the RSVP functions: cookie authentication and the common problem responses.</summary>
public static class RsvpHttp
{
    /// <summary>
    /// Authenticates the request by its <c>wp_rsvp</c> cookie: the reply must exist and the token must match the
    /// stored hash. Returns <see langword="null"/> otherwise (no cookie, malformed, unknown id or wrong token).
    /// </summary>
    public static async Task<RsvpSession?> AuthenticateAsync(IRsvpRepository repository, HttpRequest request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(repository);

        if (!RsvpCredential.TryParse(RsvpCookies.ReadCredential(request), out var credential))
        {
            return null;
        }

        var stored = await repository.GetAsync(credential.RsvpId, cancellationToken);
        return stored is not null && credential.MatchesHash(stored.Record.TokenHash) ? new RsvpSession(credential, stored) : null;
    }

    /// <summary>404 <c>not_found</c>; clears the RSVP cookies when the request carried any, so the browser forgets a stale reply.</summary>
    public static ApiResult NotFound(HttpRequest request)
    {
        if (RsvpCookies.HasAny(request))
        {
            RsvpCookies.Clear(request.HttpContext.Response);
        }

        return ApiProblem.Create(StatusCodes.Status404NotFound, ProblemCodes.NotFound);
    }

    /// <summary>503 <c>not_configured</c>.</summary>
    public static ApiResult NotConfigured() => ApiProblem.Create(StatusCodes.Status503ServiceUnavailable, ProblemCodes.NotConfigured);

    /// <summary>403 <c>rsvp_closed</c>.</summary>
    public static ApiResult Closed() => ApiProblem.Create(StatusCodes.Status403Forbidden, ProblemCodes.RsvpClosed);

    /// <summary>412 <c>precondition_failed</c>.</summary>
    public static ApiResult PreconditionFailed() => ApiProblem.Create(StatusCodes.Status412PreconditionFailed, ProblemCodes.PreconditionFailed);

    /// <summary>400 <c>validation_failed</c> with <c>errors: [{field, code}]</c>.</summary>
    public static ApiResult ValidationFailed(IReadOnlyList<RsvpValidationError> errors) => ApiProblem.Create(
        StatusCodes.Status400BadRequest,
        ProblemCodes.ValidationFailed,
        extensions: new Dictionary<string, object?> { ["errors"] = errors });

    /// <summary>
    /// The entity tag the API publishes for a stored reply (header <c>ETag</c> and body <c>version</c>): the storage
    /// ETag as a strong tag. Table Storage returns a weak tag (<c>W/"datetime'...'"</c>) that changes on every write,
    /// but RFC 9110 compares <c>If-Match</c> strongly, so an intermediary that evaluates it would never match a weak
    /// tag.
    /// </summary>
    public static string PublicETag(string storageETag)
    {
        ArgumentNullException.ThrowIfNull(storageETag);
        return storageETag.StartsWith("W/", StringComparison.Ordinal) ? storageETag[2..] : storageETag;
    }

    /// <summary>
    /// Whether an <c>If-Match</c> value matches the stored reply: <c>*</c>, or any entry of the comma-separated list
    /// that equals <see cref="PublicETag"/>. A <c>W/</c> prefix on an entry is ignored, because proxies that compress
    /// responses may weaken the tag the client received.
    /// </summary>
    public static bool IfMatchMatches(string ifMatch, string storageETag)
    {
        ArgumentNullException.ThrowIfNull(ifMatch);
        var current = PublicETag(storageETag);
        return ifMatch.Trim() == "*" || ifMatch
            .Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries)
            .Any(entry => string.Equals(PublicETag(entry), current, StringComparison.Ordinal));
    }

    /// <summary>The <c>If-Match</c> value, or <see langword="null"/> when absent or implausibly long.</summary>
    public static string? ReadIfMatch(HttpRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        var value = request.Headers.IfMatch.ToString().Trim();
        return value.Length is > 0 and <= 256 ? value : null;
    }

    /// <summary>Marks a response as uncacheable.</summary>
    public static void NoStore(HttpResponse response)
    {
        ArgumentNullException.ThrowIfNull(response);
        response.Headers.CacheControl = "no-store";
    }
}

/// <summary>An authenticated caller: the credential from the cookie and the reply it unlocks.</summary>
public sealed record RsvpSession(RsvpCredential Credential, StoredRsvp Stored);
