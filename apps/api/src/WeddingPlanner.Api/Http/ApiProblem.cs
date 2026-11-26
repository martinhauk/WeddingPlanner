using System.Text.Json;

using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.WebUtilities;

namespace WeddingPlanner.Api.Http;

/// <summary>
/// RFC 9457 problem details with a stable machine-readable <c>code</c>:
/// <c>{type, title, status, code[, detail][, …extensions]}</c> as <c>application/problem+json</c>. The text never
/// contains request data, so a problem body can be logged or shown safely.
/// </summary>
public static class ApiProblem
{
    /// <summary>Media type of problem details.</summary>
    public const string ContentType = "application/problem+json";

    private static readonly Dictionary<int, string> _types = new()
    {
        [StatusCodes.Status400BadRequest] = "https://tools.ietf.org/html/rfc9110#section-15.5.1",
        [StatusCodes.Status401Unauthorized] = "https://tools.ietf.org/html/rfc9110#section-15.5.2",
        [StatusCodes.Status403Forbidden] = "https://tools.ietf.org/html/rfc9110#section-15.5.4",
        [StatusCodes.Status404NotFound] = "https://tools.ietf.org/html/rfc9110#section-15.5.5",
        [StatusCodes.Status409Conflict] = "https://tools.ietf.org/html/rfc9110#section-15.5.10",
        [StatusCodes.Status412PreconditionFailed] = "https://tools.ietf.org/html/rfc9110#section-15.5.13",
        [StatusCodes.Status413PayloadTooLarge] = "https://tools.ietf.org/html/rfc9110#section-15.5.14",
        [StatusCodes.Status415UnsupportedMediaType] = "https://tools.ietf.org/html/rfc9110#section-15.5.16",
        [StatusCodes.Status428PreconditionRequired] = "https://tools.ietf.org/html/rfc6585#section-3",
        [StatusCodes.Status429TooManyRequests] = "https://tools.ietf.org/html/rfc6585#section-4",
        [StatusCodes.Status500InternalServerError] = "https://tools.ietf.org/html/rfc9110#section-15.6.1",
        [StatusCodes.Status503ServiceUnavailable] = "https://tools.ietf.org/html/rfc9110#section-15.6.4",
    };

    /// <summary>Creates a problem response.</summary>
    /// <param name="statusCode">The HTTP status.</param>
    /// <param name="code">A stable code from <see cref="ProblemCodes"/>.</param>
    /// <param name="detail">Optional human-readable detail (never request data).</param>
    /// <param name="extensions">Optional extra members, serialised with <see cref="ApiJson.Options"/>.</param>
    public static ApiResult Create(int statusCode, string code, string? detail = null, IReadOnlyDictionary<string, object?>? extensions = null)
    {
        ArgumentException.ThrowIfNullOrEmpty(code);

        using var buffer = new MemoryStream();
        using (var writer = new Utf8JsonWriter(buffer))
        {
            writer.WriteStartObject();
            writer.WriteString("type", _types.GetValueOrDefault(statusCode, "about:blank"));
            writer.WriteString("title", ReasonPhrases.GetReasonPhrase(statusCode));
            writer.WriteNumber("status", statusCode);
            writer.WriteString("code", code);
            if (detail is not null)
            {
                writer.WriteString("detail", detail);
            }

            foreach (var (name, value) in extensions ?? new Dictionary<string, object?>())
            {
                writer.WritePropertyName(name);
                JsonSerializer.Serialize(writer, value, ApiJson.Options);
            }

            writer.WriteEndObject();
        }

        return ApiResult.Raw(statusCode, ContentType, buffer.ToArray());
    }
}

/// <summary>Stable problem codes of the API contract.</summary>
public static class ProblemCodes
{
    /// <summary>400: the body is not valid JSON or has the wrong shape.</summary>
    public const string InvalidJson = "invalid_json";

    /// <summary>400: the body failed validation; <c>errors</c> lists <c>{field, code}</c>.</summary>
    public const string ValidationFailed = "validation_failed";

    /// <summary>401: an admin endpoint was called without a signed-in user (no <c>x-ms-client-principal</c>).</summary>
    public const string Unauthorized = "unauthorized";

    /// <summary>403: the signed-in user is not an admin (role <c>admin</c> via the <c>aad</c> provider).</summary>
    public const string Forbidden = "forbidden";

    /// <summary>403: a write from another site (<c>Sec-Fetch-Site: cross-site</c>).</summary>
    public const string CrossSiteRequest = "cross_site_request";

    /// <summary>403: the RSVP deadline has passed.</summary>
    public const string RsvpClosed = "rsvp_closed";

    /// <summary>404: unknown route, disabled feature, or no reply for this browser.</summary>
    public const string NotFound = "not_found";

    /// <summary>409: this browser already has a reply.</summary>
    public const string RsvpExists = "rsvp_exists";

    /// <summary>412: the reply changed since it was read (<c>If-Match</c> does not match).</summary>
    public const string PreconditionFailed = "precondition_failed";

    /// <summary>413: the body is larger than allowed.</summary>
    public const string PayloadTooLarge = "payload_too_large";

    /// <summary>415: the body is not <c>application/json</c>.</summary>
    public const string UnsupportedMediaType = "unsupported_media_type";

    /// <summary>428: an update needs <c>If-Match</c>.</summary>
    public const string PreconditionRequired = "precondition_required";

    /// <summary>429: too many requests; see <c>Retry-After</c>.</summary>
    public const string RateLimited = "rate_limited";

    /// <summary>500: unexpected failure.</summary>
    public const string InternalError = "internal_error";

    /// <summary>503: a setting the feature needs is missing or invalid.</summary>
    public const string NotConfigured = "not_configured";

    /// <summary>503: the maximum number of replies is reached.</summary>
    public const string CapacityReached = "capacity_reached";
}
