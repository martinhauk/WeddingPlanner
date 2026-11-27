using WeddingPlanner.Api.Features.Rsvp;
using WeddingPlanner.Api.Storage.Rsvps;
using WeddingPlanner.Domain.Rsvp;

namespace WeddingPlanner.Api.Features.Admin.Rsvps;

/// <summary>
/// Dietary consent on admin edits (<c>PUT /api/admin/rsvps/{id}</c>). Admins enter dietary data the guest gave them
/// outside the form (by email, on the phone), so the API cannot ask the guest. Instead, an edit that <b>adds or
/// changes</b> dietary data must carry <c>dietaryConsent: true</c>: the admin attests that the guest explicitly
/// consented (GDPR Art. 9(2)(a)). Without it the edit is 400 <c>validation_failed</c> with <c>dietaryConsent</c> /
/// <c>required</c>, the same error a guest gets. The attestation is recorded as <see cref="DietaryConsentSource.Admin"/>
/// with its time; which admin is not stored. The guest's own consent in the form
/// (<see cref="RsvpRecord.DietaryConsentGuestAt"/>) is never changed by an admin edit, only cleared with the data.
/// </summary>
/// <remarks>
/// <list type="bullet">
///   <item>Added or changed (see <see cref="AddsOrChanges"/>) and attested: consent from an admin, now; the guest's own
///   consent time stays (for example when an admin fixes a typo in the name of a person with dietary data).</item>
///   <item>Unchanged, or only removed, with some dietary data left: the stored consent, source and time stay as they
///   are (no attestation needed; one sent anyway is ignored, so it never replaces a guest's own consent).</item>
///   <item>No dietary data left: no consent (flag, source, time and the guest's consent time cleared), as after a
///   guest write.</item>
/// </list>
/// </remarks>
public static class AdminDietaryConsent
{
    /// <summary>
    /// Whether <paramref name="updated"/> adds or changes dietary data compared with <paramref name="stored"/>. People
    /// are matched by id, so <paramref name="updated"/> must have its ids assigned (<see cref="PersonIds.Assign"/>). A
    /// person adds or changes dietary data with a tag that the same person did not have, or with a note that is new
    /// or different; a new person (an id that was not stored) with any dietary data adds some. A renamed person (a
    /// different name, compared after sanitising) who still has any dietary data counts too: the data may now
    /// belong to someone else, for example when an admin types a new companion into an existing slot. Removing tags,
    /// notes or people, renaming people without dietary data and changing the other answers add nothing.
    /// </summary>
    public static bool AddsOrChanges(RsvpAnswer stored, RsvpAnswer updated)
    {
        ArgumentNullException.ThrowIfNull(stored);
        ArgumentNullException.ThrowIfNull(updated);

        var before = new Dictionary<string, RsvpPerson>(StringComparer.Ordinal);
        foreach (var person in stored.People)
        {
            if (person.Id is { } id)
            {
                before.TryAdd(id, person);
            }
        }

        return updated.People.Any(person =>
        {
            var previous = person.Id is { } id ? before.GetValueOrDefault(id) : null;
            var tagAdded = person.DietaryTags.Any(tag => previous is null || !previous.DietaryTags.Contains(tag, StringComparer.Ordinal));
            var noteAddedOrChanged = person.DietaryNote is { } note && !string.Equals(note, previous?.DietaryNote, StringComparison.Ordinal);
            var renamedWithData = previous is not null
                && !string.Equals(person.Name, previous.Name, StringComparison.Ordinal)
                && (person.DietaryTags.Count > 0 || person.DietaryNote is not null);
            return tagAdded || noteAddedOrChanged || renamedWithData;
        });
    }

    /// <summary>
    /// <paramref name="record"/> (the stored reply with the admin's answer, ids assigned) with its consent fields set
    /// after comparing it with <paramref name="current"/> (see the class remarks), or <see langword="null"/> when the
    /// edit adds or changes dietary data and <paramref name="attestation"/> is not <see langword="true"/>.
    /// </summary>
    public static RsvpRecord? Apply(RsvpRecord current, RsvpRecord record, bool? attestation, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(current);
        ArgumentNullException.ThrowIfNull(record);

        if (!RsvpDietaryConsent.HasDietaryData(record.Answer))
        {
            return RsvpDietaryConsent.WithoutConsent(record);
        }

        var guestConsentAt = RsvpDietaryConsent.GuestConsentAt(current);
        if (!AddsOrChanges(current.Answer, record.Answer))
        {
            return record with
            {
                DietaryConsent = current.DietaryConsent,
                DietaryConsentSource = current.DietaryConsentSource,
                DietaryConsentAt = current.DietaryConsentAt,
                DietaryConsentGuestAt = guestConsentAt,
            };
        }

        return attestation == true
            ? record with
            {
                DietaryConsent = true,
                DietaryConsentSource = DietaryConsentSource.Admin,
                DietaryConsentAt = now,
                DietaryConsentGuestAt = guestConsentAt,
            }
            : null;
    }
}
