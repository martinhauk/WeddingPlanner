namespace WeddingPlanner.Domain.Rsvp;

/// <summary>A validated, normalised RSVP reply (the output of <see cref="RsvpValidator"/>).</summary>
/// <param name="Attending">Yes or no.</param>
/// <param name="People">One to <see cref="RsvpLimits.MaxPeople"/> people, the guest first.</param>
/// <param name="Message">The message to the couple, or <see langword="null"/>.</param>
/// <param name="Language">Lower-case language tag, for example <c>de</c> or <c>es</c>.</param>
public sealed record RsvpAnswer(
    bool Attending,
    IReadOnlyList<RsvpPerson> People,
    string? Message,
    string Language)
{
    /// <summary>Prints no personal data (the default record output would include the message).</summary>
    public override string ToString() => $"RsvpAnswer {{ Attending = {Attending}, People = {People.Count} }}";
}

/// <summary>One person of an <see cref="RsvpAnswer"/>.</summary>
/// <param name="Id">
/// Stable id of the person within the reply. Validation passes through the id the client sent (or
/// <see langword="null"/>); <see cref="PersonIds.Assign"/> fills in every id before the reply is stored.
/// </param>
/// <param name="Name">Sanitised name, 1 to <see cref="RsvpLimits.MaxNameLength"/> characters.</param>
/// <param name="DietaryTags">Known tags in canonical order without duplicates; always empty for a "no".</param>
/// <param name="DietaryNote">Sanitised note or <see langword="null"/>; always <see langword="null"/> for a "no".</param>
public sealed record RsvpPerson(
    string? Id,
    string Name,
    IReadOnlyList<string> DietaryTags,
    string? DietaryNote)
{
    /// <summary>Prints no personal data (the default record output would include the name and the note).</summary>
    public override string ToString() => $"RsvpPerson {{ Id = {Id} }}";
}
