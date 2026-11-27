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
    /// Top-level domains common in spam and in the guests' countries. Deliberately curated: words that end academic
    /// titles typed without spaces (<c>Dr.med.vet.</c>, <c>Dr.in</c>, <c>B.Sc.</c>, <c>Dr.-Ing.</c>, <c>Mag.art.</c>)
    /// are left out, even where they are real top-level domains (<c>.vet</c>, <c>.in</c>, <c>.sc</c>, <c>.ing</c>,
    /// <c>.art</c>, <c>.med</c>). Top-level domains that are also name particles or short names are in
    /// <see cref="NameLikeTopLevelDomains"/> instead.
    /// </summary>
    private const string TopLevelDomains =
        "com|net|org|info|biz|io|co|me|app|dev|xyz|top|shop|store|online|site|website|link|click|gg|tv|cc|ws|"
        + "pro|club|live|life|blog|news|page|email|space|tech|cloud|fun|icu|vip|win|bid|buzz|rest|cyou|sbs|cfd|tk|ml|ga|cf|"
        + "gq|mobi|name|asia|at|ch|es|eu|uk|fr|it|nl|be|pl|pt|se|dk|fi|cz|sk|ro|gr|tr|ua|ru|cn|jp|kr|us|ca|au|"
        + "nz|za|br|mx|ar|cl|ie";

    /// <summary>
    /// Top-level domains that are also name particles or short names, typed right after an abbreviation or initial
    /// without a space: <c>de</c> (<c>Mª.de los Ángeles</c>, <c>lic.de la cruz</c>, <c>J.de Vries</c>), the surnames
    /// <c>li</c>, <c>lu</c>, <c>hu</c> and <c>ly</c> (<c>Wei J.LI</c>) and the given name <c>ai</c>. Such a top-level
    /// domain makes a domain only where a name part cannot stand: nothing but punctuation follows it, or a path, port,
    /// query or fragment does (<c>/</c>, <c>:</c>, <c>?</c>, <c>#</c>), and the label before the dot ends in two
    /// letters or digits, so it is no initial. A particle that is ever added to the curated list (<c>da</c>,
    /// <c>do</c>, <c>la</c>, <c>le</c>, <c>di</c>, <c>du</c>) belongs here.
    /// </summary>
    private const string NameLikeTopLevelDomains = "de|ai|hu|li|lu|ly";

    /// <summary>
    /// A web address: <c>://</c> anywhere, <c>www.</c> starting a word, or a domain, which is a <c>label.tld</c> with a
    /// top-level domain from <see cref="TopLevelDomains"/> that is not followed by a letter or digit (<c>spam.shop</c>,
    /// <c>x.io</c>, <c>mail.example.co.uk</c>, <c>Buy at example.com now</c>), or with one from
    /// <see cref="NameLikeTopLevelDomains"/> under that list's stricter conditions (<c>example.de</c>,
    /// <c>shop.de?x</c>, <c>bit.ly/x</c>, but not <c>J.de Vries</c>). The top-level domain must be all lower or all
    /// upper case, so a capitalised word after a dot (<c>Prof.Dr.</c>, <c>Lic.De la Cruz</c>) is no domain. A domain
    /// branch starts a label only at the start of a run of letters, digits and hyphens and backtracks at most over
    /// that run, so matching stays linear in the name's length (at most <see cref="RsvpLimits.MaxNameLength"/>).
    /// </summary>
    [GeneratedRegex(
        @"://|(?<![\p{L}\p{N}])(?i:www)\."
        + @"|(?<![\p{L}\p{N}-])[\p{L}\p{N}-]+\.(?:(?:" + TopLevelDomains + @")|(?i:(?:" + TopLevelDomains + @"))(?<=\.\p{Lu}+))(?![\p{L}\p{N}])"
        + @"|(?<![\p{L}\p{N}-])[\p{L}\p{N}-]*[\p{L}\p{N}]{2}\.(?:(?:" + NameLikeTopLevelDomains + @")|(?i:(?:" + NameLikeTopLevelDomains + @"))(?<=\.\p{Lu}+))(?=[/:?#]|[\s\p{P}]*\z)",
        RegexOptions.CultureInvariant)]
    private static partial Regex WebAddress();
}
