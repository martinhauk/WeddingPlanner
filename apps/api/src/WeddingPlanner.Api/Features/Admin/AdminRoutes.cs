namespace WeddingPlanner.Api.Features.Admin;

/// <summary>
/// Routes of the admin API under <c>/api/admin/</c>. The Functions host refuses any function route that starts with
/// <c>admin</c> (its own management API lives at <c>/admin/*</c>; "The specified route conflicts with one or more
/// built in routes"), even with the <c>api</c> route prefix. A route parameter whose constraint only accepts the
/// literal <c>admin</c> passes that check and keeps the public path <c>/api/admin/…</c>, which the SWA route rule
/// <c>/api/admin*</c> protects with role <c>admin</c>. The parameter is never read.
/// </summary>
public static class AdminRoutes
{
    /// <summary>The first route segment: matches only <c>admin</c>.</summary>
    public const string Prefix = "{adminArea:regex(^admin$)}";

    /// <summary><c>/api/admin/rsvps</c>.</summary>
    public const string Rsvps = Prefix + "/rsvps";

    /// <summary><c>/api/admin/rsvps/{id}</c>.</summary>
    public const string Rsvp = Prefix + "/rsvps/{id}";

    /// <summary><c>/api/admin/export.csv</c>.</summary>
    public const string ExportCsv = Prefix + "/export.csv";
}
