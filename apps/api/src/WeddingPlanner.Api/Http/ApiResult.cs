using System.Text.Json;

using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace WeddingPlanner.Api.Http;

/// <summary>
/// A complete response (status, content type, body) that functions return as <see cref="IActionResult"/> and
/// middleware writes directly with <see cref="WriteAsync"/>. It needs no MVC services and serialises with
/// <see cref="ApiJson.Options"/>, so every body the API writes follows the same JSON rules.
/// </summary>
public sealed class ApiResult : IActionResult
{
    private readonly byte[] _body;

    private ApiResult(int statusCode, string? contentType, byte[] body)
    {
        StatusCode = statusCode;
        ContentType = contentType;
        _body = body;
    }

    /// <summary>The HTTP status code.</summary>
    public int StatusCode { get; }

    /// <summary>The content type, or <see langword="null"/> for an empty body.</summary>
    public string? ContentType { get; }

    /// <summary>The UTF-8 body.</summary>
    public ReadOnlyMemory<byte> Body => _body;

    /// <summary>A JSON response serialised with <see cref="ApiJson.Options"/>.</summary>
    public static ApiResult Json<T>(int statusCode, T value) =>
        new(statusCode, ApiJson.ContentType, JsonSerializer.SerializeToUtf8Bytes(value, ApiJson.Options));

    /// <summary>A response with the given content type and pre-serialised body.</summary>
    public static ApiResult Raw(int statusCode, string contentType, byte[] body) => new(statusCode, contentType, body);

    /// <summary>An empty response, for example 204 No Content.</summary>
    public static ApiResult Empty(int statusCode) => new(statusCode, contentType: null, body: []);

    /// <inheritdoc/>
    public Task ExecuteResultAsync(ActionContext context)
    {
        ArgumentNullException.ThrowIfNull(context);
        return WriteAsync(context.HttpContext.Response, context.HttpContext.RequestAborted);
    }

    /// <summary>Writes status, content type and body to <paramref name="response"/> (headers set earlier are kept).</summary>
    public async Task WriteAsync(HttpResponse response, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(response);

        response.StatusCode = StatusCode;
        if (ContentType is not null)
        {
            response.ContentType = ContentType;
        }

        response.ContentLength = _body.Length;
        if (_body.Length > 0)
        {
            await response.Body.WriteAsync(_body, cancellationToken);
        }
    }
}
