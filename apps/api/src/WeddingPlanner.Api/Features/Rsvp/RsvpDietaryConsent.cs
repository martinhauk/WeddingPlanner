using WeddingPlanner.Api.Storage.Rsvps;
using WeddingPlanner.Domain.Rsvp;

namespace WeddingPlanner.Api.Features.Rsvp;

/// <summary>
/// Explicit consent for dietary data. Allergies and intolerances can be health data (GDPR Art. 9), so a reply that
/// carries any dietary tag or note is stored only with <c>dietaryConsent: true</c> (Art. 9(2)(a)); otherwise it is
/// 400 <c>validation_failed</c> with <c>dietaryConsent</c> / <c>required</c>. Replies without dietary data (every
/// "no", whose dietary data the validator drops) need no consent. The stored flag, its source and its time record the
/// latest consent, and a separate time keeps the guest's own consent in the form, so the couple can show it was given
/// (Art. 7(1)). Admin edits follow their own rule (<c>Features/Admin/Rsvps/AdminDietaryConsent</c>).
/// </summary>
public static class RsvpDietaryConsent
{
    /// <summary>The request member and the <c>field</c> of its validation error.</summary>
    public const string Field = "dietaryConsent";

    /// <summary>The validation error of missing consent.</summary>
    public static RsvpValidationError Required { get; } = new(Field, RsvpValidationCodes.Required);

    /// <summary>Whether any person of the validated reply has a dietary tag or note.</summary>
    public static bool HasDietaryData(RsvpAnswer answer)
    {
        ArgumentNullException.ThrowIfNull(answer);
        return answer.People.Any(person => person.DietaryTags.Count > 0 || person.DietaryNote is not null);
    }

    /// <summary>
    /// The validation error for <paramref name="answer"/> with <paramref name="consent"/>, or <see langword="null"/>
    /// when it may be stored. After a successful check, store the reply through <see cref="RecordGuestConsent"/>.
    /// </summary>
    public static RsvpValidationError? Check(RsvpAnswer answer, bool? consent) =>
        HasDietaryData(answer) && consent != true ? Required : null;

    /// <summary>
    /// <paramref name="record"/> after a guest write whose consent passed <see cref="Check"/>: consent given by the guest
    /// at <paramref name="now"/> when the reply has dietary data (also as the guest's own consent time,
    /// <see cref="RsvpRecord.DietaryConsentGuestAt"/>), no consent otherwise.
    /// </summary>
    public static RsvpRecord RecordGuestConsent(RsvpRecord record, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(record);
        return HasDietaryData(record.Answer)
            ? record with
            {
                DietaryConsent = true,
                DietaryConsentSource = DietaryConsentSource.Guest,
                DietaryConsentAt = now,
                DietaryConsentGuestAt = now,
            }
            : WithoutConsent(record);
    }

    /// <summary>
    /// When the guest of <paramref name="record"/> last consented in the form: <see cref="RsvpRecord.DietaryConsentGuestAt"/>,
    /// or, on rows written before that column existed, the consent time of a consent recorded with source
    /// <see cref="DietaryConsentSource.Guest"/>. <see langword="null"/> when there is no guest consent on record.
    /// </summary>
    public static DateTimeOffset? GuestConsentAt(RsvpRecord record)
    {
        ArgumentNullException.ThrowIfNull(record);
        return record.DietaryConsentGuestAt
            ?? (record.DietaryConsentSource == DietaryConsentSource.Guest ? record.DietaryConsentAt : null);
    }

    /// <summary>
    /// <paramref name="record"/> without consent: flag, source, time and the guest's own consent time cleared (a reply
    /// without dietary data).
    /// </summary>
    public static RsvpRecord WithoutConsent(RsvpRecord record)
    {
        ArgumentNullException.ThrowIfNull(record);
        return record with { DietaryConsent = false, DietaryConsentSource = null, DietaryConsentAt = null, DietaryConsentGuestAt = null };
    }
}
