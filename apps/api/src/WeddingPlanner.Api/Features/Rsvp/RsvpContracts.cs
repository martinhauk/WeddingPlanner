using WeddingPlanner.Api.Storage.Rsvps;
using WeddingPlanner.Domain.Rsvp;

namespace WeddingPlanner.Api.Features.Rsvp;

/// <summary>
/// Body of <c>POST /api/rsvp</c> and <c>PUT /api/rsvp/me</c>. Every member is optional here so a missing value is
/// reported by validation (400 <c>validation_failed</c>) rather than as malformed JSON.
/// </summary>
public sealed record RsvpRequest(
    bool? Attending,
    IReadOnlyList<RsvpPersonRequest?>? People,
    string? Message,
    string? Language,
    string? Website)
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
public sealed record RsvpView(
    string Id,
    bool Attending,
    IReadOnlyList<RsvpPersonView> People,
    string? Message,
    string Language,
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
public sealed record RsvpCreatedResponse(RsvpView Rsvp);

/// <summary>Body of <c>GET</c> and <c>PUT /api/rsvp/me</c>.</summary>
/// <param name="Rsvp">The caller's reply.</param>
/// <param name="Open">Whether it can still be changed or deleted (deadline not passed).</param>
/// <param name="Deadline">The deadline (UTC), omitted when not configured.</param>
public sealed record RsvpMineResponse(RsvpView Rsvp, bool Open, DateTime? Deadline);

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
