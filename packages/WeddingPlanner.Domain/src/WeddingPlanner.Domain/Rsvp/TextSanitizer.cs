using System.Globalization;
using System.Text;

namespace WeddingPlanner.Domain.Rsvp;

/// <summary>
/// Normalises guest-entered text before it is validated and stored. The output is never rendered as HTML;
/// sanitising here only removes characters that are invisible or can disguise text:
/// <list type="bullet">
///   <item>control characters (C0, DEL, C1), lone UTF-16 surrogates and Unicode noncharacters (U+FDD0...U+FDEF and
///   every code point ending in FFFE or FFFF) are removed;</item>
///   <item>format characters (Unicode category Cf) are removed: bidirectional formatting characters (LRM, RLM, ALM,
///   LRE...RLO, LRI...PDI), the BOM, the soft hyphen, zero-width space, word joiner, invisible operators, tag
///   characters and the like; so are the standalone Hangul fillers U+3164 and U+FFA0;</item>
///   <item>tabs become spaces; line breaks (CR, LF, CRLF, NEL, LS, PS) become <c>\n</c> in multi-line text and
///   spaces otherwise;</item>
///   <item>the result is NFC-normalised and trimmed; single-line text also collapses runs of whitespace;</item>
///   <item>text that is left with nothing visible (only whitespace, joiners, variation selectors and similar
///   invisible marks) becomes empty, so it counts as missing.</item>
/// </list>
/// Joiners (ZWJ, ZWNJ) and variation selectors stay, because emoji sequences and several scripts need them. Tag
/// characters are removed although subdivision flags use them (such a flag shows as a plain black flag), because
/// they can carry hidden text.
/// </summary>
public static class TextSanitizer
{
    private const int ZeroWidthNonJoiner = 0x200C;
    private const int ZeroWidthJoiner = 0x200D;

    /// <summary>Sanitises a single-line value such as a name or a dietary note. <see langword="null"/> becomes empty.</summary>
    public static string SingleLine(string? value) => Sanitize(value, multiLine: false);

    /// <summary>Sanitises a multi-line value such as the message to the couple. <see langword="null"/> becomes empty.</summary>
    public static string MultiLine(string? value) => Sanitize(value, multiLine: true);

    /// <summary>True for the bidirectional formatting characters that can reorder displayed text.</summary>
    public static bool IsBidiControl(char c) => c is '\u061C' or '\u200E' or '\u200F' or (>= '\u202A' and <= '\u202E') or (>= '\u2066' and <= '\u2069');

    /// <summary>
    /// True for the invisible characters that are removed: every format character (Unicode category Cf) except the
    /// joiners ZWNJ (U+200C) and ZWJ (U+200D), plus the standalone Hangul fillers U+3164 and U+FFA0 (letters by
    /// category, but rendered as nothing). Covers <see cref="IsBidiControl"/> and the BOM.
    /// </summary>
    public static bool IsRemovedInvisible(int codePoint) =>
        codePoint is 0x3164 or 0xFFA0
        || (codePoint is not (ZeroWidthNonJoiner or ZeroWidthJoiner) && CharUnicodeInfo.GetUnicodeCategory(codePoint) == UnicodeCategory.Format);

    /// <summary>
    /// True for the 66 Unicode noncharacters: U+FDD0...U+FDEF and the last two code points of every plane
    /// (U+FFFE, U+FFFF, U+1FFFE, U+1FFFF, ..., U+10FFFF). They are never valid in interchanged text, and .NET's
    /// normalisation rejects some of them.
    /// </summary>
    public static bool IsNoncharacter(int codePoint) => codePoint is (>= 0xFDD0 and <= 0xFDEF) || (codePoint & 0xFFFE) == 0xFFFE;

    private static string Sanitize(string? value, bool multiLine)
    {
        if (string.IsNullOrEmpty(value))
        {
            return string.Empty;
        }

        var builder = new StringBuilder(value.Length);
        for (var index = 0; index < value.Length; index++)
        {
            var c = value[index];

            if (char.IsHighSurrogate(c))
            {
                if (index + 1 < value.Length && char.IsLowSurrogate(value[index + 1]))
                {
                    var codePoint = char.ConvertToUtf32(c, value[index + 1]);
                    if (!IsNoncharacter(codePoint) && !IsRemovedInvisible(codePoint))
                    {
                        builder.Append(c).Append(value[index + 1]);
                    }

                    index++;
                }

                continue;
            }

            if (char.IsLowSurrogate(c))
            {
                continue;
            }

            if (c == '\r')
            {
                // CRLF counts as one line break: skip the CR and let the LF produce it.
                if (index + 1 < value.Length && value[index + 1] == '\n')
                {
                    continue;
                }

                AppendLineBreak(builder, multiLine);
                continue;
            }

            if (c is '\n' or '\u0085' or '\u2028' or '\u2029')
            {
                AppendLineBreak(builder, multiLine);
                continue;
            }

            if (c == '\t')
            {
                builder.Append(' ');
                continue;
            }

            if (char.IsControl(c) || IsRemovedInvisible(c) || IsNoncharacter(c))
            {
                continue;
            }

            builder.Append(!multiLine && char.IsWhiteSpace(c) ? ' ' : c);
        }

        var normalized = NormalizeOrKeep(builder.ToString());
        var result = multiLine ? TrimLines(normalized) : CollapseSpaces(normalized);
        return HasVisibleCharacter(result) ? result : string.Empty;
    }

    private static bool HasVisibleCharacter(string value)
    {
        foreach (var rune in value.EnumerateRunes())
        {
            if (!Rune.IsWhiteSpace(rune) && !IsKeptInvisible(rune.Value))
            {
                return true;
            }
        }

        return false;
    }

    /// <summary>
    /// Invisible characters that stay because they modify their neighbours, but do not make text non-empty: the
    /// joiners, the combining grapheme joiner, the Hangul choseong and jungseong fillers and the variation selectors.
    /// </summary>
    private static bool IsKeptInvisible(int codePoint) => codePoint is ZeroWidthNonJoiner or ZeroWidthJoiner
        or 0x034F or 0x115F or 0x1160 or (>= 0x180B and <= 0x180D) or 0x180F
        or (>= 0xFE00 and <= 0xFE0F) or (>= 0xE0100 and <= 0xE01EF);

    /// <summary>
    /// NFC-normalises <paramref name="value"/>. The loop above already drops everything known to make
    /// <see cref="string.Normalize(NormalizationForm)"/> throw; should the platform still reject a code point,
    /// the text is kept un-normalised rather than failing the request.
    /// </summary>
    private static string NormalizeOrKeep(string value)
    {
        try
        {
            return value.Normalize(NormalizationForm.FormC);
        }
        catch (ArgumentException)
        {
            return value;
        }
    }

    private static void AppendLineBreak(StringBuilder builder, bool multiLine) => builder.Append(multiLine ? '\n' : ' ');

    private static string CollapseSpaces(string value)
    {
        var builder = new StringBuilder(value.Length);
        foreach (var c in value)
        {
            if (c == ' ' && (builder.Length == 0 || builder[^1] == ' '))
            {
                continue;
            }

            builder.Append(c);
        }

        return builder.ToString().TrimEnd(' ');
    }

    private static string TrimLines(string value)
    {
        // Trailing whitespace on each line carries no meaning; leading indentation is kept.
        var lines = value.Split('\n').Select(line => line.TrimEnd());
        return string.Join('\n', lines).Trim();
    }
}
