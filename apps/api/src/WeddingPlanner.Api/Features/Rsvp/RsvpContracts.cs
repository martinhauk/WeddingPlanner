using WeddingPlanner.Api.Storage.Rsvps;
using WeddingPlanner.Domain.Rsvp;

namespace WeddingPlanner.Api.Features.Rsvp;

/// <summary>
/// Body of <c>POST /api/rsvp</c> and <c>PUT /api/rsvp/me</c>. Every member is optional here so a missing value is
/// reported by validation (400 <c>validation_failed</c>) rather than as malformed JSON.
/// </summary>
/// <param name="Attending">Yes or no.</param>
/// <param name="People">The guest first, then the companions.</param>
/// <param name="Message">Optional message to the couple.</param>
/// <param name="Language">The language the guest used.</param>
/// <param name="Website">Honeypot: must stay empty (<see cref="RsvpSubmissionGuard"/>).</param>
/// <param name="DietaryConsent">
/// Explicit consent to store the dietary data (GDPR Art. 9(2)(a)); required when the reply carries any (see
/// <see cref="RsvpDietaryConsent"/>).
/// </param>
/// <param name="ElapsedMs">
/// Milliseconds between showing the form and sending it; <c>POST</c> only, checked against the minimum fill time
/// (<see cref="RsvpSubmissionGuard"/>).
/// </param>
public sealed record RsvpRequest(
    bool? Attending,
    IReadOnlyList<RsvpPersonRequest?>? People,
    string? Message,
    string? Language,
    string? Website,
    bool? DietaryConsent = null,
    long? ElapsedMs = null)
{
    /// <summary>The domain draft for <see cref="RsvpValidator"/>.</summary>
    public RsvpDraft ToDraft() => new(
        Attending,
        People?.Select(person => person is null ? null : new RsvpDraftPerson(person.Id, person.Name, person.Dietary?.Tags, person.Dietary?.Note)).ToList(),
        Message,
        Language,
        Website);

    /// <summary>Prints no personal data.</summary>
    public override string ToString() => nameof(RsvpRequest);
}

/// <summary>One person in an <see cref="RsvpRequest"/>; <c>id</c> only when updating a person returned earlier.</summary>
public sealed record RsvpPersonRequest(string? Id, string? Name, RsvpDietaryRequest? Dietary)
{
    /// <summary>Prints no personal data.</summary>
    public override string ToString() => nameof(RsvpPersonRequest);
}

/// <summary>Dietary needs of one person: known tags plus an optional note.</summary>
public sealed record RsvpDietaryRequest(IReadOnlyList<string?>? Tags, string? Note)
{
    /// <summary>Prints no personal data.</summary>
    public override string ToString() => nameof(RsvpDietaryRequest);
}

/// <summary>A reply as the API returns it.</summary>
/// <param name="Id">Reply id.</param>
/// <param name="Attending">Yes or no.</param>
/// <param name="People">The guest first, then the companions.</param>
/// <param name="Message">The message to the couple, omitted when empty.</param>
/// <param name="Language">The language the guest used.</param>
/// <param name="DietaryConsent">Whether the dietary data was stored with the guest's explicit consent.</param>
/// <param name="CreatedAt">When the reply was created (UTC).</param>
/// <param name="UpdatedAt">When the reply was last changed (UTC).</param>
public sealed record RsvpView(
    string Id,
    bool Attending,
    IReadOnlyList<RsvpPersonView> People,
    string? Message,
    string Language,
    bool DietaryConsent,
    DateTime CreatedAt,
    DateTime UpdatedAt)
{
    /// <summary>Maps a stored record (timestamps as UTC).</summary>
    public static RsvpView From(RsvpRecord record)
    {
        ArgumentNullException.ThrowIfNull(record);

        var answer = record.Answer;
        return new RsvpView(
            record.Id,
            answer.Attending,
            answer.People.Select(person => new RsvpPersonView(person.Id ?? string.Empty, person.Name, new RsvpDietaryView(person.DietaryTags, person.DietaryNote))).ToList(),
            answer.Message,
            answer.Language,
            record.DietaryConsent,
            record.CreatedAt.UtcDateTime,
            record.UpdatedAt.UtcDateTime);
    }

    /// <summary>Prints no personal data.</summary>
    public override string ToString() => $"RsvpView {{ Id = {Id} }}";
}

/// <summary>One person of an <see cref="RsvpView"/>.</summary>
public sealed record RsvpPersonView(string Id, string Name, RsvpDietaryView Dietary)
{
    /// <summary>Prints no personal data.</summary>
    public override string ToString() => $"RsvpPersonView {{ Id = {Id} }}";
}

/// <summary>Dietary needs of one person; <c>note</c> is omitted when empty.</summary>
public sealed record RsvpDietaryView(IReadOnlyList<string> Tags, string? Note)
{
    /// <summary>Prints no personal data.</summary>
    public override string ToString() => nameof(RsvpDietaryView);
}

/// <summary>Body of 201 from <c>POST /api/rsvp</c>.</summary>
/// <param name="Rsvp">The created reply.</param>
/// <param name="Version">The reply's entity tag (the <c>ETag</c> header value, quotes included) for <c>If-Match</c>.</param>
/// <param name="EditToken">
/// The secret of the personal edit link, <c>&lt;rsvpId&gt;.&lt;token&gt;</c>: the same credential as the <c>wp_rsvp</c>
/// cookie (<see cref="RsvpCredential"/>). The page shows it once as <c>&lt;site origin&gt;/#edit=&lt;editToken&gt;</c>, and
/// <c>POST /api/rsvp/claim</c> turns it into the cookies of another browser. Returned only here; never logged.
/// </param>
public sealed record RsvpCreatedResponse(RsvpView Rsvp, string Version, string EditToken)
{
    /// <summary>Never prints the edit token or personal data (records print every member by default).</summary>
    public override string ToString() => $"RsvpCreatedResponse {{ Rsvp = {Rsvp} }}";
}

/// <summary>Body of <c>POST /api/rsvp/claim</c>.</summary>
/// <param name="EditToken">The secret of the personal edit link, <c>&lt;rsvpId&gt;.&lt;token&gt;</c>.</param>
/// <param name="Preview">
/// <see langword="true"/>: only look at the link (<see cref="RsvpClaimPreviewResponse"/>) without taking the reply into
/// this browser. Omitted or <see langword="false"/>: claim it.
/// </param>
public sealed record RsvpClaimRequest(string? EditToken, bool? Preview = null)
{
    /// <summary>Never prints the edit token.</summary>
    public override string ToString() => nameof(RsvpClaimRequest);
}

/// <summary>
/// Body of 200 from <c>POST /api/rsvp/claim</c> with <c>"preview": true</c>: only the names of the link's reply, so a
/// browser that already holds another reply can ask the guest who they are before replacing it.
/// </summary>
/// <param name="Names">The names of the reply's people, the guest first.</param>
public sealed record RsvpClaimPreviewResponse(IReadOnlyList<string> Names)
{
    /// <summary>Prints no personal data.</summary>
    public override string ToString() => nameof(RsvpClaimPreviewResponse);
}

/// <summary>Body of <c>GET</c> and <c>PUT /api/rsvp/me</c> and of a claim.</summary>
/// <param name="Rsvp">The caller's reply.</param>
/// <param name="Version">
/// The reply's entity tag (the <c>ETag</c> header value, quotes included), so the client can send <c>If-Match</c>
/// even when a proxy drops or changes the header.
/// </param>
/// <param name="Open">Whether it can still be changed or deleted (deadline not passed).</param>
/// <param name="Deadline">The deadline (UTC), omitted when not configured.</param>
/// <param name="EditToken">
/// The secret of this reply's personal edit link, <c>&lt;rsvpId&gt;.&lt;token&gt;</c>: the credential of the request's own
/// <c>wp_rsvp</c> cookie (or of the claimed link), so a returning guest can see the link again. Never logged.
/// </param>
public sealed record RsvpMineResponse(RsvpView Rsvp, string Version, bool Open, DateTime? Deadline, string EditToken)
{
    /// <summary>Never prints the edit token or personal data (records print every member by default).</summary>
    public override string ToString() => $"RsvpMineResponse {{ Rsvp = {Rsvp} }}";
}

/// <summary>Body of <c>GET /api/rsvp/status</c>.</summary>
/// <param name="Enabled">Whether the RSVP API is configured (storage and deadline).</param>
/// <param name="Open">Whether new replies are accepted now: enabled, deadline not passed and not full.</param>
/// <param name="Full">Whether the cap on stored replies is reached.</param>
/// <param name="Deadline">The deadline (UTC), omitted when not configured.</param>
/// <param name="TimeZone">IANA time zone to show the deadline in.</param>
/// <param name="Limits">Input limits for the form.</param>
public sealed record RsvpStatusResponse(bool Enabled, bool Open, bool Full, DateTime? Deadline, string TimeZone, RsvpLimitsView Limits);

/// <summary>The input limits the form should enforce (the API enforces them too).</summary>
public sealed record RsvpLimitsView(
    int MaxPeople,
    int MaxCompanions,
    int MaxNameLength,
    int MaxNoteLength,
    int MaxMessageLength,
    IReadOnlyList<string> DietaryTags)
{
    /// <summary>The view of <paramref name="limits"/>.</summary>
    public static RsvpLimitsView From(RsvpLimits limits)
    {
        ArgumentNullException.ThrowIfNull(limits);
        return new RsvpLimitsView(
            limits.MaxPeople,
            limits.MaxCompanions,
            RsvpLimits.MaxNameLength,
            RsvpLimits.MaxNoteLength,
            RsvpLimits.MaxMessageLength,
            Domain.Rsvp.DietaryTags.All);
    }
}
