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
    /// <c>.art</c>, <c>.med</c>). Top-level domains that are also name particles, abbreviations or short names are in
    /// <see cref="NameLikeTopLevelDomains"/> instead. Any other top-level domain counts when a path follows.
    /// </summary>
    private const string TopLevelDomains =
        "com|net|org|info|biz|io|co|me|app|dev|xyz|top|shop|store|online|site|website|link|click|gg|tv|cc|ws|"
        + "pro|club|live|life|blog|news|page|email|space|tech|cloud|fun|icu|vip|win|bid|buzz|rest|cyou|sbs|cfd|tk|ml|ga|cf|"
        + "gq|mobi|name|at|es|eu|uk|it|nl|be|pl|pt|se|dk|fi|cz|sk|ro|gr|tr|ua|ru|cn|jp|kr|us|ca|au|"
        + "nz|za|br|mx|ar|cl|ie|"
        + "bond|lol|best|quest|monster|uno|work|lat|mom|cam|bar|casa|loan|men|pw|xxx|casino|bet|dating|zip|mov|"
        + "beauty|hair|skin|makeup|autos|boats|homes|yachts|pics|today|support";

    /// <summary>
    /// Top-level domains that are also name particles, abbreviations or short names, typed right after an abbreviation
    /// or initial without a space: <c>de</c> (<c>Mª.de los Ángeles</c>, <c>lic.de la cruz</c>, <c>J.de Vries</c>),
    /// <c>fr</c> and <c>ch</c> (<c>HR.U.FR. MÜLLER</c>, <c>joh.fr. müller</c>, <c>a.ch. müller</c>), the surnames
    /// <c>li</c>, <c>lu</c>, <c>hu</c>, <c>ly</c>, <c>su</c> and <c>to</c> (<c>Wei J.LI</c>) and the given names
    /// <c>ai</c> and <c>asia</c> (<c>m.asia example</c>). Such a top-level domain makes a domain only at the end of the
    /// name (nothing but characters other than letters and digits follow it) and after a label that ends in two letters
    /// or digits, so it is no initial. A particle that is ever added to the curated list (<c>da</c>, <c>do</c>,
    /// <c>la</c>, <c>le</c>, <c>di</c>, <c>du</c>) belongs here.
    /// </summary>
    private const string NameLikeTopLevelDomains = "de|ai|hu|li|lu|ly|su|to|fr|ch|asia";

    /// <summary>
    /// Titles that are never the label of a domain, so a surname that is also a top-level domain may follow them
    /// without a space, in any case: <c>DR.LI</c>, <c>prof.lu</c>, <c>DR.PAGE</c>.
    /// </summary>
    private const string Titles = "dr|dra|drs|prof|mr|mrs|ms|mx|sr|sra|hr|fr|mme";

    // The case rule of the three domain branches. A branch starts a label at the start of a run of letters, digits
    // and hyphens, and that label is no title (Start). The top-level domain is matched in any case. All caps
    // counts only after an all-caps label that ends in two capitals or digits (CapsLabel: EXAMPLE.COM, but not
    // Dr.LI, Yuki.AI or J.LINK); any other label needs another casing (NotAllCaps). A capitalised word is never a
    // top-level domain (NotCapitalised: Prof.Dr., Lic.De la Cruz, J.Bar), any other casing is (spam.cOM).
    private const string Start = @"(?<![\p{L}\p{N}-])(?!(?i:" + Titles + @")\.)";

    private const string CapsLabel = @"[\p{Lu}\p{N}-]*[\p{Lu}\p{N}]{2}\.";

    private const string NotAllCaps = @"(?<!\.\p{Lu}+)";

    private const string NotCapitalised = @"(?<!\.\p{Lu}\p{Ll}+)";

    /// <summary>
    /// A web address: <c>://</c> anywhere, <c>www.</c> starting a word, or a domain under the case rule above
    /// (<c>EXAMPLE.COM</c> and <c>spam.cOM</c> are domains, <c>Dr.LI</c>, <c>DR.PAGE</c> and <c>Lic.De</c> are not).
    /// A domain is a <c>label.tld</c> with any top-level domain followed by a path, query, fragment or port
    /// (<c>x.ly/abc</c>, <c>example.xyz?ref=1</c>, <c>example.ai:8080</c>); a top-level domain from
    /// <see cref="TopLevelDomains"/> not followed by a letter or digit (<c>spam.shop</c>, <c>x.io</c>,
    /// <c>mail.example.co.uk</c>, <c>Buy at example.com now</c>); or one from <see cref="NameLikeTopLevelDomains"/>
    /// under that list's stricter conditions (<c>example.de</c>, <c>bit.ly</c>, but not <c>J.de Vries</c>). A domain
    /// branch starts a label only at the start of a run of letters, digits and hyphens and backtracks at most over
    /// that run, so matching stays linear in the name's length (at most <see cref="RsvpLimits.MaxNameLength"/>).
    /// </summary>
    [GeneratedRegex(
        @"://|(?<![\p{L}\p{N}])(?i:www)\."
        + "|" + Start + @"(?:" + CapsLabel + @"(?i:[a-z]{2,24})|[\p{L}\p{N}-]+\.(?i:[a-z]{2,24})" + NotAllCaps + ")"
        + NotCapitalised + @"(?=[/?#]|:\d)"
        + "|" + Start + @"(?:" + CapsLabel + @"(?i:" + TopLevelDomains + @")|[\p{L}\p{N}-]+\.(?i:" + TopLevelDomains + ")"
        + NotAllCaps + ")" + NotCapitalised + @"(?![\p{L}\p{N}])"
        + "|" + Start + @"(?:" + CapsLabel + @"(?i:" + NameLikeTopLevelDomains + @")|[\p{L}\p{N}-]*[\p{L}\p{N}]{2}\.(?i:"
        + NameLikeTopLevelDomains + ")" + NotAllCaps + ")" + NotCapitalised + @"(?=[^\p{L}\p{N}]*\z)",
        RegexOptions.CultureInvariant)]
    private static partial Regex WebAddress();
}
