using System.Text;
using System.Text.Json;

using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Abstractions;
using Microsoft.AspNetCore.Routing;

namespace WeddingPlanner.Api.Tests.Support;

/// <summary>Builds requests for function tests and reads back what the function wrote.</summary>
internal static class TestHttp
{
    private static readonly JsonSerializerOptions _json = new(JsonSerializerDefaults.Web);

    /// <summary>A request with an optional JSON body (serialised camelCase) and headers.</summary>
    public static DefaultHttpContext Request(
        string method,
        string path,
        object? json = null,
        string? rawBody = null,
        string? contentType = "application/json",
        string? cookie = null,
        IReadOnlyDictionary<string, string>? headers = null)
    {
        var httpContext = new DefaultHttpContext();
        httpContext.Request.Method = method;
        httpContext.Request.Path = path;
        httpContext.Request.Scheme = "https";
        httpContext.Request.Host = new HostString("localhost");
        httpContext.Response.Body = new MemoryStream();

        var body = rawBody ?? (json is null ? null : JsonSerializer.Serialize(json, _json));
        if (body is not null)
        {
            var bytes = Encoding.UTF8.GetBytes(body);
            httpContext.Request.Body = new MemoryStream(bytes);
            httpContext.Request.ContentLength = bytes.Length;
        }

        if (contentType is not null && body is not null)
        {
            httpContext.Request.ContentType = contentType;
        }

        if (cookie is not null)
        {
            httpContext.Request.Headers.Cookie = cookie;
        }

        foreach (var (name, value) in headers ?? new Dictionary<string, string>())
        {
            httpContext.Request.Headers[name] = value;
        }

        return httpContext;
    }

    /// <summary>Executes a function result like the ASP.NET Core integration of the worker does.</summary>
    public static Task ExecuteAsync(IActionResult result, HttpContext httpContext) =>
        result.ExecuteResultAsync(new ActionContext(httpContext, new RouteData(), new ActionDescriptor()));

    public static string ReadBody(HttpContext httpContext)
    {
        httpContext.Response.Body.Position = 0;
        using var reader = new StreamReader(httpContext.Response.Body, leaveOpen: true);
        return reader.ReadToEnd();
    }

    public static JsonElement ReadJson(HttpContext httpContext)
    {
        using var document = JsonDocument.Parse(ReadBody(httpContext));
        return document.RootElement.Clone();
    }

    /// <summary>Every <c>Set-Cookie</c> header of the response.</summary>
    public static string[] SetCookies(HttpContext httpContext) => httpContext.Response.Headers.SetCookie.OfType<string>().ToArray();

    /// <summary>The <c>Set-Cookie</c> header for <paramref name="name"/>, or <see langword="null"/>.</summary>
    public static string? SetCookie(HttpContext httpContext, string name) =>
        SetCookies(httpContext).SingleOrDefault(header => header.StartsWith(name + "=", StringComparison.Ordinal));

    /// <summary>A <c>Cookie</c> request header that sends back every cookie the response set.</summary>
    public static string CookieHeader(HttpContext httpContext) =>
        string.Join("; ", SetCookies(httpContext).Select(header => header.Split(';')[0]));
}
