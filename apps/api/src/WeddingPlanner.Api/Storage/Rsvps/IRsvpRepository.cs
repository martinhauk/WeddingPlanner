using WeddingPlanner.Domain.Rsvp;

namespace WeddingPlanner.Api.Storage.Rsvps;

/// <summary>
/// The <c>Rsvps</c> table: one entity per reply (partition <c>rsvp</c>, row key = reply id). Only the SHA-256 hash
/// of the edit token is stored; no IP addresses, no cookies.
/// </summary>
public interface IRsvpRepository
{
    /// <summary>Whether storage is configured (no I/O). When <see langword="false"/>, every other member throws.</summary>
    bool IsConfigured { get; }

    /// <summary>Reads a reply, or <see langword="null"/> when it does not exist.</summary>
    Task<StoredRsvp?> GetAsync(string id, CancellationToken cancellationToken);

    /// <summary>Adds a new reply and returns it with its ETag.</summary>
    Task<StoredRsvp> AddAsync(RsvpRecord record, CancellationToken cancellationToken);

    /// <summary>
    /// Replaces a reply if its ETag still is <paramref name="ifMatch"/>. Returns <see langword="null"/> when the reply no
    /// longer exists.
    /// </summary>
    /// <exception cref="ConcurrencyConflictException">The reply changed since <paramref name="ifMatch"/> was read.</exception>
    Task<StoredRsvp?> ReplaceAsync(RsvpRecord record, string ifMatch, CancellationToken cancellationToken);

    /// <summary>Deletes a reply if its ETag still is <paramref name="ifMatch"/>; <see langword="false"/> when it did not exist.</summary>
    /// <exception cref="ConcurrencyConflictException">The reply changed since <paramref name="ifMatch"/> was read.</exception>
    Task<bool> DeleteAsync(string id, string ifMatch, CancellationToken cancellationToken);

    /// <summary>Reads every stored reply with its ETag (admin views; the table holds a few hundred replies at most).</summary>
    Task<IReadOnlyList<StoredRsvp>> ListAsync(CancellationToken cancellationToken);

    /// <summary>Counts the stored replies (reads only the keys).</summary>
    Task<int> CountAsync(CancellationToken cancellationToken);
}

/// <summary>A reply as stored.</summary>
/// <param name="Id">Reply id (32 lower-case hex characters).</param>
/// <param name="Answer">The validated reply, every person with an id.</param>
/// <param name="TokenHash">Lower-case hex SHA-256 of the edit token.</param>
/// <param name="CreatedAt">When the reply was created (UTC).</param>
/// <param name="UpdatedAt">When the reply was last changed (UTC).</param>
/// <param name="DietaryConsent">
/// Whether the stored dietary data has the guest's explicit consent (GDPR Art. 9(2)(a)): given in the guest's own
/// form, or attested by an admin who entered the data. Every reply with dietary data written since consent was
/// recorded has it; <see langword="false"/> for replies without dietary data.
/// </param>
/// <param name="DietaryConsentSource">
/// Who recorded the consent: the guest's own write, or an admin's attestation. <see langword="null"/> when there is no
/// consent, and on rows written before the source was stored (only guest writes set the flag then).
/// </param>
/// <param name="DietaryConsentAt">When the consent was recorded (UTC); <see langword="null"/> like the source.</param>
public sealed record RsvpRecord(
    string Id,
    RsvpAnswer Answer,
    string TokenHash,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt,
    bool DietaryConsent = false,
    DietaryConsentSource? DietaryConsentSource = null,
    DateTimeOffset? DietaryConsentAt = null)
{
    /// <summary>Never prints the token hash or personal data (records print every member by default).</summary>
    public override string ToString() => $"RsvpRecord {{ Id = {Id} }}";
}

/// <summary>Who recorded the consent to store a reply's dietary data (<see cref="RsvpRecord.DietaryConsentSource"/>).</summary>
public enum DietaryConsentSource
{
    /// <summary>The guest consented in the reply form (<c>POST /api/rsvp</c>, <c>PUT /api/rsvp/me</c>).</summary>
    Guest,

    /// <summary>
    /// An admin entered or changed the dietary data and attested that the guest explicitly consented
    /// (<c>PUT /api/admin/rsvps/{id}</c> with <c>dietaryConsent: true</c>). Which admin is not stored.
    /// </summary>
    Admin,
}

/// <summary>A stored reply with its ETag (the optimistic-concurrency version).</summary>
public sealed record StoredRsvp(RsvpRecord Record, string ETag);
