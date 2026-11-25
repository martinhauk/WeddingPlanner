using System.Buffers;
using System.Diagnostics.CodeAnalysis;
using System.Text.Json;

using Microsoft.AspNetCore.Http;
using Microsoft.Net.Http.Headers;

namespace WeddingPlanner.Api.Http;

/// <summary>
/// Reads a JSON request body with a hard size limit. The limit holds even without <c>Content-Length</c>
/// (chunked bodies): reading stops one byte past it. Errors come back as ready-made problem responses.
/// </summary>
public static class JsonBody
{
    /// <summary>
    /// Reads and deserialises the body: 415 <c>unsupported_media_type</c> unless the content type is
    /// <c>application/json</c> (UTF-8), 413 <c>payload_too_large</c> above <paramref name="maxBytes"/>, and 400
    /// <c>invalid_json</c> for malformed JSON, a JSON <c>null</c> or values of the wrong type.
    /// </summary>
    public static async Task<JsonBodyResult<T>> ReadAsync<T>(HttpRequest request, int maxBytes, CancellationToken cancellationToken)
        where T : class
    {
        ArgumentNullException.ThrowIfNull(request);
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(maxBytes);

        if (!IsJson(request.ContentType))
        {
            return JsonBodyResult<T>.Fail(ApiProblem.Create(StatusCodes.Status415UnsupportedMediaType, ProblemCodes.UnsupportedMediaType));
        }

        if (request.ContentLength > maxBytes)
        {
            return JsonBodyResult<T>.Fail(TooLarge(maxBytes));
        }

        var buffer = ArrayPool<byte>.Shared.Rent(maxBytes + 1);
        try
        {
            var length = 0;
            int read;
            while (length <= maxBytes
                && (read = await request.Body.ReadAsync(buffer.AsMemory(length, maxBytes + 1 - length), cancellationToken)) > 0)
            {
                length += read;
            }

            if (length > maxBytes)
            {
                return JsonBodyResult<T>.Fail(TooLarge(maxBytes));
            }

            T? value;
            try
            {
                value = JsonSerializer.Deserialize<T>(buffer.AsSpan(0, length), ApiJson.Options);
            }
            catch (JsonException)
            {
                value = null;
            }

            return value is null
                ? JsonBodyResult<T>.Fail(ApiProblem.Create(StatusCodes.Status400BadRequest, ProblemCodes.InvalidJson))
                : JsonBodyResult<T>.Ok(value);
        }
        finally
        {
            ArrayPool<byte>.Shared.Return(buffer);
        }
    }

    /// <summary>
    /// Whether <paramref name="contentType"/> is <c>application/json</c>, optionally with <c>charset=utf-8</c>.
    /// Anything else (form posts, <c>text/plain</c>, other charsets) is rejected, which also blocks the simple
    /// cross-site requests a browser sends without a preflight.
    /// </summary>
    public static bool IsJson(string? contentType)
    {
        if (!MediaTypeHeaderValue.TryParse(contentType, out var mediaType)
            || !mediaType.MediaType.Equals("application/json", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        var charset = mediaType.Charset;
        return !charset.HasValue || charset.Equals("utf-8", StringComparison.OrdinalIgnoreCase);
    }

    private static ApiResult TooLarge(int maxBytes) => ApiProblem.Create(
        StatusCodes.Status413PayloadTooLarge,
        ProblemCodes.PayloadTooLarge,
        extensions: new Dictionary<string, object?> { ["maxBytes"] = maxBytes });
}

/// <summary>Either the deserialised body or the problem response to return.</summary>
public sealed class JsonBodyResult<T>
    where T : class
{
    private JsonBodyResult(T? value, ApiResult? problem)
    {
        Value = value;
        Problem = problem;
    }

    /// <summary>The body, or <see langword="null"/> when <see cref="Problem"/> is set.</summary>
    public T? Value { get; }

    /// <summary>The 400, 413 or 415 response, or <see langword="null"/> on success.</summary>
    public ApiResult? Problem { get; }

    /// <summary>Returns the body, or the problem response to answer with.</summary>
    public bool TryGetValue([NotNullWhen(true)] out T? value, [NotNullWhen(false)] out ApiResult? problem)
    {
        value = Value;
        problem = Problem;
        return value is not null;
    }

    internal static JsonBodyResult<T> Ok(T value) => new(value, null);

    internal static JsonBodyResult<T> Fail(ApiResult problem) => new(null, problem);
}
