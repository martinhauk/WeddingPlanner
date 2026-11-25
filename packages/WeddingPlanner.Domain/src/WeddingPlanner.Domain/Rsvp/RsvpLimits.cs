namespace WeddingPlanner.Domain.Rsvp;

/// <summary>
/// Size limits of one RSVP reply. The text limits are fixed; the number of companions can only be lowered
/// per deployment (at most <see cref="MaxCompanionsCeiling"/>, so a reply names at most six people).
/// Lengths are counted in UTF-16 code units after normalisation, like <c>maxlength</c> in the browser.
/// </summary>
public sealed class RsvpLimits
{
    /// <summary>Largest allowed number of companions (the product limit: the guest plus five).</summary>
    public const int MaxCompanionsCeiling = 5;

    /// <summary>Longest name of one person.</summary>
    public const int MaxNameLength = 80;

    /// <summary>Longest free-text dietary note of one person.</summary>
    public const int MaxNoteLength = 200;

    /// <summary>Longest message to the couple.</summary>
    public const int MaxMessageLength = 1000;

    /// <summary>
    /// Most dietary tag entries for one person. There are only four tags; the cap keeps a body full of bogus entries
    /// from producing one validation error per entry.
    /// </summary>
    public const int MaxDietaryTagEntries = 10;

    /// <summary>Longest language tag (BCP 47 primary language plus one subtag).</summary>
    public const int MaxLanguageLength = 12;

    /// <summary>Creates limits with <paramref name="maxCompanions"/> companions (0 to <see cref="MaxCompanionsCeiling"/>).</summary>
    public RsvpLimits(int maxCompanions)
    {
        ArgumentOutOfRangeException.ThrowIfNegative(maxCompanions);
        ArgumentOutOfRangeException.ThrowIfGreaterThan(maxCompanions, MaxCompanionsCeiling);
        MaxCompanions = maxCompanions;
    }

    /// <summary>The product default: five companions, six people in total.</summary>
    public static RsvpLimits Default { get; } = new(MaxCompanionsCeiling);

    /// <summary>Companions allowed in addition to the guest who answers.</summary>
    public int MaxCompanions { get; }

    /// <summary>People allowed in one reply (the guest plus the companions).</summary>
    public int MaxPeople => MaxCompanions + 1;
}
