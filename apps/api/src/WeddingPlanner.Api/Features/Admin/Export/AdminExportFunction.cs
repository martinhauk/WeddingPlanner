using System.Globalization;

using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.Functions.Worker;

using WeddingPlanner.Api.Features.Rsvp;
using WeddingPlanner.Api.Http;
using WeddingPlanner.Api.Storage.Rsvps;

namespace WeddingPlanner.Api.Features.Admin.Export;

/// <summary>
/// <c>GET /api/admin/export.csv</c>: every reply as CSV (see <see cref="RsvpCsv"/>), as a download named
/// <c>antworten-yyyy-MM-dd.csv</c> (today in the RSVP time zone). Gated by <c>Features__Admin</c> and the admin
/// authorization middleware; <c>Cache-Control: no-store</c>.
/// </summary>
public sealed class AdminExportFunction(IRsvpRepository repository, RsvpSettings settings, TimeProvider timeProvider)
{
    /// <summary>Function name of <c>GET /api/admin/export.csv</c>.</summary>
    public const string FunctionName = "AdminExportCsv";

    [Function(FunctionName)]
    public async Task<IActionResult> Run(
        [HttpTrigger(AuthorizationLevel.Anonymous, "get", Route = AdminRoutes.ExportCsv)] HttpRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var response = request.HttpContext.Response;
        RsvpHttp.NoStore(response);

        if (!repository.IsConfigured)
        {
            return RsvpHttp.NotConfigured();
        }

        var stored = await repository.ListAsync(cancellationToken);
        var timeZone = TimeZoneInfo.TryFindSystemTimeZoneById(settings.TimeZoneId, out var zone) ? zone : TimeZoneInfo.Utc;
        var today = TimeZoneInfo.ConvertTime(timeProvider.GetUtcNow(), timeZone).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

        response.Headers.ContentDisposition = $"attachment; filename=\"antworten-{today}.csv\"";
        response.Headers.XContentTypeOptions = "nosniff";
        return ApiResult.Raw(StatusCodes.Status200OK, RsvpCsv.ContentType, RsvpCsv.Write(stored.Select(item => item.Record), timeZone));
    }
}
