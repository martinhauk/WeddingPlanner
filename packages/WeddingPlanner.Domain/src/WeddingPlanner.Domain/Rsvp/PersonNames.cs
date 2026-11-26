using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace WeddingPlanner.Domain.Rsvp;

/// <summary>
/// Rules for one person's name in a reply, applied after <see cref="TextSanitizer.SingleLine"/>: at least
/// <see cref="RsvpLimits.MinNameLength"/> characters, at least one letter, and no web address or <c>@</c>. They keep
/// junk out cheaply; they are not meant to judge real names, so titles and initials (<c>Dr. med.</c>,
/// <c>J. R. R.</c>), hyphens and apostrophes all pass.
/// </summary>
public static partial class PersonNames
{
    /// <summary>
    /// The <see cref="RsvpValidationCodes"/> code that <paramref name="name"/> breaks, or <see langword="null"/> when it
    /// is fine. Emptiness and the maximum length are checked by the validator before.
    /// </summary>
    public static string? Check(string name)
    {
        ArgumentNullException.ThrowIfNull(name);

        if (name.EnumerateRunes().Count() < RsvpLimits.MinNameLength)
        {
            return RsvpValidationCodes.TooShort;
        }

        return !name.EnumerateRunes().Any(Rune.IsLetter) || name.Contains('@') || name.Contains('＠') || WebAddress().IsMatch(name)
            ? RsvpValidationCodes.Invalid
            : null;
    }

    /// <summary>
    /// The key two names of one reply are compared by: case, diacritics and punctuation are ignored, so
    /// <c>María-José García</c> and <c>maria jose GARCIA</c> are the same person. (Transliterations such as
    /// <c>Müller</c> / <c>Mueller</c> are not folded.)
    /// </summary>
    public static string DuplicateKey(string name)
    {
        ArgumentNullException.ThrowIfNull(name);

        var key = new StringBuilder(name.Length);
        var pendingSpace = false;
        foreach (var rune in name.Normalize(NormalizationForm.FormD).EnumerateRunes())
        {
            if (Rune.GetUnicodeCategory(rune) == UnicodeCategory.NonSpacingMark)
            {
                continue;
            }

            if (!Rune.IsLetterOrDigit(rune))
            {
                pendingSpace = key.Length > 0;
                continue;
            }

            if (pendingSpace)
            {
                key.Append(' ');
                pendingSpace = false;
            }

            key.Append(Rune.ToLowerInvariant(rune).ToString());
        }

        return key.ToString();
    }

    /// <summary>
    /// A URL scheme (<c>https://</c>), <c>www.</c>, or a domain: a label of three or more characters, a dot and a
    /// lower-case top-level domain (<c>spam.com</c>, <c>bit.ly/x</c>). Two-letter labels and capitalised words after
    /// the dot are left alone, so <c>Dr.med.</c> or <c>J.R.R.</c> are no web address.
    /// </summary>
    [GeneratedRegex(@"(?i:[a-z][a-z0-9+.-]*://|(?<![\p{L}\p{N}])www\.)|(?<![\p{L}\p{N}-])[\p{L}\p{N}-]{3,}\.[a-z]{2,24}(?![\p{L}\p{N}])", RegexOptions.CultureInvariant)]
    private static partial Regex WebAddress();
}
