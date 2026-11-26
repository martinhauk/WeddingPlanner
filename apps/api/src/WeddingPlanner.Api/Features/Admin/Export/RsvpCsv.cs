using System.Globalization;
using System.Text;

using WeddingPlanner.Api.Storage.Rsvps;
using WeddingPlanner.Domain.Rsvp;

namespace WeddingPlanner.Api.Features.Admin.Export;

/// <summary>
/// The CSV export of all replies, made for German Excel: UTF-8 with BOM, semicolon separator, CRLF line ends, one
/// row per person (replies oldest first, people in reply order). Every cell is quoted (<c>"</c> doubled), and a cell
/// that starts with <c>=</c>, <c>+</c>, <c>-</c>, <c>@</c>, tab or carriage return gets a leading <c>'</c>, so a
/// spreadsheet never evaluates guest input as a formula (CSV injection). The message to the couple appears only on
/// the reply's first row; times are shown in the RSVP time zone as <c>yyyy-MM-dd HH:mm</c>.
/// </summary>
public static class RsvpCsv
{
    /// <summary>Column separator (German Excel expects a semicolon).</summary>
    public const char Separator = ';';

    /// <summary>Media type of the export.</summary>
    public const string ContentType = "text/csv; charset=utf-8";

    private const string LineEnd = "\r\n";

    private static readonly char[] _formulaStarts = ['=', '+', '-', '@', '\t', '\r'];

    private static readonly Dictionary<string, string> _dietaryHeaders = new(StringComparer.Ordinal)
    {
        [DietaryTags.Vegetarian] = "Vegetarisch",
        [DietaryTags.Vegan] = "Vegan",
        [DietaryTags.GlutenFree] = "Glutenfrei",
        [DietaryTags.LactoseFree] = "Laktosefrei",
    };

    /// <summary>The header row (German).</summary>
    public static IReadOnlyList<string> Header { get; } =
    [
        "Antwort-ID",
        "Zusage",
        "Person",
        "Name",
        .. DietaryTags.All.Select(tag => _dietaryHeaders.GetValueOrDefault(tag, tag)),
        "Hinweis Essen",
        "Nachricht",
        "Sprache",
        "Erstellt",
        "Geändert",
    ];

    /// <summary>The export as UTF-8 bytes with BOM.</summary>
    public static byte[] Write(IEnumerable<RsvpRecord> records, TimeZoneInfo timeZone)
    {
        var encoding = new UTF8Encoding(encoderShouldEmitUTF8Identifier: true);
        return [.. encoding.GetPreamble(), .. encoding.GetBytes(ToText(records, timeZone))];
    }

    /// <summary>The export as text (without the BOM).</summary>
    public static string ToText(IEnumerable<RsvpRecord> records, TimeZoneInfo timeZone)
    {
        ArgumentNullException.ThrowIfNull(records);
        ArgumentNullException.ThrowIfNull(timeZone);

        var builder = new StringBuilder();
        AppendRow(builder, Header);

        var ordered = records.OrderBy(record => record.CreatedAt).ThenBy(record => record.Id, StringComparer.Ordinal);
        foreach (var record in ordered)
        {
            var answer = record.Answer;
            for (var index = 0; index < answer.People.Count; index++)
            {
                var person = answer.People[index];
                AppendRow(builder,
                [
                    record.Id,
                    answer.Attending ? "ja" : "nein",
                    (index + 1).ToString(CultureInfo.InvariantCulture),
                    person.Name,
                    .. DietaryTags.All.Select(tag => person.DietaryTags.Contains(tag, StringComparer.Ordinal) ? "x" : string.Empty),
                    person.DietaryNote,
                    index == 0 ? answer.Message : null,
                    answer.Language,
                    FormatTime(record.CreatedAt, timeZone),
                    FormatTime(record.UpdatedAt, timeZone),
                ]);
            }
        }

        return builder.ToString();
    }

    /// <summary>One quoted, injection-safe cell.</summary>
    public static string Cell(string? value)
    {
        var text = value ?? string.Empty;
        if (text.Length > 0 && Array.IndexOf(_formulaStarts, text[0]) >= 0)
        {
            text = "'" + text;
        }

        return "\"" + text.Replace("\"", "\"\"", StringComparison.Ordinal) + "\"";
    }

    private static void AppendRow(StringBuilder builder, IEnumerable<string?> cells)
    {
        builder.AppendJoin(Separator, cells.Select(Cell));
        builder.Append(LineEnd);
    }

    private static string FormatTime(DateTimeOffset time, TimeZoneInfo timeZone) =>
        TimeZoneInfo.ConvertTime(time, timeZone).ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture);
}
