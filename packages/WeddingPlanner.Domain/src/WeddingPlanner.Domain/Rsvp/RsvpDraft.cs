namespace WeddingPlanner.Domain.Rsvp;

/// <summary>
/// An RSVP reply as the guest sent it, before validation. Every member is optional so that a missing value
/// becomes a validation error instead of a parse failure.
/// </summary>
/// <param name="Attending">Yes (<see langword="true"/>) or no.</param>
/// <param name="People">The guest first, then the companions. A "no" may also name several people.</param>
/// <param name="Message">Optional message to the couple.</param>
/// <param name="Language">The language the guest used (for example <c>de</c>).</param>
/// <param name="Website">Honeypot field: hidden in the form, so it must stay empty.</param>
public sealed record RsvpDraft(
    bool? Attending,
    IReadOnlyList<RsvpDraftPerson?>? People,
    string? Message,
    string? Language,
    string? Website)
{
    /// <summary>Prints no personal data (the default record output would include the message).</summary>
    public override string ToString() => $"RsvpDraft {{ Attending = {Attending}, People = {People?.Count} }}";
}

/// <summary>One person of an <see cref="RsvpDraft"/>.</summary>
/// <param name="Id">The person's id from an earlier reply (kept on update), or <see langword="null"/> for a new person.</param>
/// <param name="Name">The person's name.</param>
/// <param name="DietaryTags">Ticked dietary checkboxes (see <see cref="DietaryTags"/>).</param>
/// <param name="DietaryNote">Optional free-text dietary note.</param>
public sealed record RsvpDraftPerson(
    string? Id,
    string? Name,
    IReadOnlyList<string?>? DietaryTags,
    string? DietaryNote)
{
    /// <summary>Prints no personal data (the default record output would include the name and the note).</summary>
    public override string ToString() => "RsvpDraftPerson";
}
