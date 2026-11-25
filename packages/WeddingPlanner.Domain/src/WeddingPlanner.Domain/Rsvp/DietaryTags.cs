namespace WeddingPlanner.Domain.Rsvp;

/// <summary>
/// The dietary checkboxes a guest can tick per person. Tags are matched exactly (case-sensitive, as the
/// web app sends them); anything else is rejected, so stored data only ever holds these values.
/// </summary>
public static class DietaryTags
{
    /// <summary>No meat or fish.</summary>
    public const string Vegetarian = "vegetarian";

    /// <summary>No animal products.</summary>
    public const string Vegan = "vegan";

    /// <summary>No gluten.</summary>
    public const string GlutenFree = "glutenFree";

    /// <summary>No lactose.</summary>
    public const string LactoseFree = "lactoseFree";

    /// <summary>Every known tag, in the canonical order used for stored and returned replies.</summary>
    public static IReadOnlyList<string> All { get; } = [Vegetarian, Vegan, GlutenFree, LactoseFree];

    /// <summary>Whether <paramref name="tag"/> is one of <see cref="All"/> (exact, ordinal match).</summary>
    public static bool IsKnown(string? tag) => tag is not null && All.Contains(tag, StringComparer.Ordinal);
}
