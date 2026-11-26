using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;

using WeddingPlanner.Api.Features.Admin.Export;
using WeddingPlanner.Api.Features.Admin.Rsvps;

namespace WeddingPlanner.Api.Tests.Support;

/// <summary>
/// Calls the admin functions on the services of an <see cref="RsvpHarness"/> (same repository, settings and clock as
/// the guest functions). Authorization is middleware and tested on its own, so these calls carry no principal.
/// </summary>
internal static class AdminCalls
{
    /// <summary><c>GET /api/admin/rsvps</c>.</summary>
    public static async Task<HttpContext> AdminListAsync(this RsvpHarness harness)
    {
        var httpContext = TestHttp.Request("GET", "/api/admin/rsvps");
        await TestHttp.ExecuteAsync(await Functions(harness).List(httpContext.Request, CancellationToken.None), httpContext);
        return httpContext;
    }

    /// <summary><c>PUT /api/admin/rsvps/{id}</c>.</summary>
    public static async Task<HttpContext> AdminPutAsync(this RsvpHarness harness, string id, object body, string? ifMatch)
    {
        var headers = ifMatch is null ? null : new Dictionary<string, string> { ["If-Match"] = ifMatch };
        var httpContext = TestHttp.Request("PUT", $"/api/admin/rsvps/{id}", body, headers: headers);
        await TestHttp.ExecuteAsync(await Functions(harness).Update(httpContext.Request, id, CancellationToken.None), httpContext);
        return httpContext;
    }

    /// <summary><c>DELETE /api/admin/rsvps/{id}</c>.</summary>
    public static async Task<HttpContext> AdminDeleteAsync(this RsvpHarness harness, string id, string? ifMatch = null)
    {
        var headers = ifMatch is null ? null : new Dictionary<string, string> { ["If-Match"] = ifMatch };
        var httpContext = TestHttp.Request("DELETE", $"/api/admin/rsvps/{id}", headers: headers);
        await TestHttp.ExecuteAsync(await Functions(harness).Delete(httpContext.Request, id, CancellationToken.None), httpContext);
        return httpContext;
    }

    /// <summary><c>GET /api/admin/export.csv</c>.</summary>
    public static async Task<HttpContext> AdminExportAsync(this RsvpHarness harness)
    {
        var httpContext = TestHttp.Request("GET", "/api/admin/export.csv");
        var function = ActivatorUtilities.CreateInstance<AdminExportFunction>(harness.Services);
        await TestHttp.ExecuteAsync(await function.Run(httpContext.Request, CancellationToken.None), httpContext);
        return httpContext;
    }

    /// <summary>The raw response bytes (the CSV export starts with a BOM).</summary>
    public static byte[] ReadBytes(HttpContext httpContext)
    {
        httpContext.Response.Body.Position = 0;
        using var buffer = new MemoryStream();
        httpContext.Response.Body.CopyTo(buffer);
        return buffer.ToArray();
    }

    private static AdminRsvpsFunctions Functions(RsvpHarness harness) => ActivatorUtilities.CreateInstance<AdminRsvpsFunctions>(harness.Services);
}
