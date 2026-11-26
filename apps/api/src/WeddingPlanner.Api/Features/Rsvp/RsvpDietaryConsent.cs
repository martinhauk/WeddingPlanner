using WeddingPlanner.Domain.Rsvp;

namespace WeddingPlanner.Api.Features.Rsvp;

/// <summary>
/// Explicit consent for dietary data. Allergies and intolerances can be health data (GDPR Art. 9), so a reply that
/// carries any dietary tag or note is stored only with <c>dietaryConsent: true</c> (Art. 9(2)(a)); otherwise it is
/// 400 <c>validation_failed</c> with <c>dietaryConsent</c> / <c>required</c>. Replies without dietary data (every
/// "no", whose dietary data the validator drops) need no consent. The stored flag records the consent, so the couple
/// can show it was given (Art. 7(1)).
/// </summary>
public static class RsvpDietaryConsent
{
    /// <summary>The request member and the <c>field</c> of its validation error.</summary>
    public const string Field = "dietaryConsent";

    /// <summary>Whether any person of the validated reply has a dietary tag or note.</summary>
    public static bool HasDietaryData(RsvpAnswer answer)
    {
        ArgumentNullException.ThrowIfNull(answer);
        return answer.People.Any(person => person.DietaryTags.Count > 0 || person.DietaryNote is not null);
    }

    /// <summary>
    /// The validation error for <paramref name="answer"/> with <paramref name="consent"/>, or <see langword="null"/>
    /// when it may be stored. After a successful check, the consent to store is <see cref="HasDietaryData"/>.
    /// </summary>
    public static RsvpValidationError? Check(RsvpAnswer answer, bool? consent) =>
        HasDietaryData(answer) && consent != true ? new RsvpValidationError(Field, RsvpValidationCodes.Required) : null;
}
