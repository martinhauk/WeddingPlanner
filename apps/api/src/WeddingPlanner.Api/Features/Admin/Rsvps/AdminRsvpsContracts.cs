using WeddingPlanner.Api.Features.Rsvp;
using WeddingPlanner.Api.Storage.Rsvps;

namespace WeddingPlanner.Api.Features.Admin.Rsvps;

/// <summary>Body of <c>GET /api/admin/rsvps</c>: every reply (latest change first) and the totals.</summary>
public sealed record AdminRsvpListResponse(IReadOnlyList<AdminRsvpView> Rsvps, AdminRsvpTotals Totals);

/// <summary>A reply as the admin API returns it: the guest view plus its <c>version</c> for <c>If-Match</c>.</summary>
public sealed record AdminRsvpView(
    string Id,
    bool Attending,
    IReadOnlyList<RsvpPersonView> People,
    string? Message,
    string Language,
    DateTime CreatedAt,
    DateTime UpdatedAt,
    string Version)
{
    /// <summary>Maps a stored reply (timestamps as UTC, <c>version</c> as the public ETag).</summary>
    public static AdminRsvpView From(StoredRsvp stored)
    {
        ArgumentNullException.ThrowIfNull(stored);

        var view = RsvpView.From(stored.Record);
        return new AdminRsvpView(
            view.Id,
            view.Attending,
            view.People,
            view.Message,
            view.Language,
            view.CreatedAt,
            view.UpdatedAt,
            RsvpHttp.PublicETag(stored.ETag));
    }

    /// <summary>Prints no personal data.</summary>
    public override string ToString() => $"AdminRsvpView {{ Id = {Id} }}";
}

/// <summary>Body of 200 from <c>PUT /api/admin/rsvps/{id}</c>.</summary>
public sealed record AdminRsvpUpdatedResponse(AdminRsvpView Rsvp);
