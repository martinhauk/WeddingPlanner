using System.Text;

using Shouldly;

using WeddingPlanner.Api.Features.Admin.Export;
using WeddingPlanner.Api.Storage.Rsvps;
using WeddingPlanner.Domain.Rsvp;

using Xunit;

namespace WeddingPlanner.Api.Tests.Admin;

/// <summary>The CSV export format, pinned by a golden file that also covers CSV injection. Fictional data only.</summary>
public sealed class RsvpCsvTests
{
    private static readonly TimeZoneInfo _berlin = TimeZoneInfo.FindSystemTimeZoneById("Europe/Berlin");

    [Fact]
    public void GoldenExportNeutralisesFormulasAndQuotesEveryCell()
    {
        var accepted = Record(
            "aaaa1111",
            attending: true,
            created: new DateTimeOffset(2099, 3, 1, 10, 0, 0, TimeSpan.Zero),
            updated: new DateTimeOffset(2099, 4, 1, 10, 0, 0, TimeSpan.Zero),
            message: "Hallo \"Anna\"; schön!\nBis bald",
            language: "de",
            Person("=HYPERLINK(\"http://example.com\";\"x\")", "+49 Allergie", DietaryTags.Vegetarian, DietaryTags.GlutenFree),
            Person("@Pablo", "-", DietaryTags.Vegan),
            Person("\tTab", null, DietaryTags.LactoseFree),
            Person("María-José García", "Nüsse"));
        var declined = Record(
            "bbbb2222",
            attending: false,
            created: new DateTimeOffset(2099, 2, 1, 8, 30, 0, TimeSpan.Zero),
            updated: new DateTimeOffset(2099, 2, 1, 8, 30, 0, TimeSpan.Zero),
            message: null,
            language: "es",
            Person("\rCR", null),
            Person("-1+1", null));

        var bytes = RsvpCsv.Write([accepted, declined], _berlin);

        // {LF}, {CR} and {TAB} stand for characters inside cells; the real line ends are CRLF.
        var expected = """
            "Antwort-ID";"Zusage";"Person";"Name";"Vegetarisch";"Vegan";"Glutenfrei";"Laktosefrei";"Hinweis Essen";"Nachricht";"Sprache";"Erstellt";"Geändert"
            "bbbb2222";"nein";"1";"'{CR}CR";"";"";"";"";"";"";"es";"2099-02-01 09:30";"2099-02-01 09:30"
            "bbbb2222";"nein";"2";"'-1+1";"";"";"";"";"";"";"es";"2099-02-01 09:30";"2099-02-01 09:30"
            "aaaa1111";"ja";"1";"'=HYPERLINK(""http://example.com"";""x"")";"x";"";"x";"";"'+49 Allergie";"Hallo ""Anna""; schön!{LF}Bis bald";"de";"2099-03-01 11:00";"2099-04-01 12:00"
            "aaaa1111";"ja";"2";"'@Pablo";"";"x";"";"";"'-";"";"de";"2099-03-01 11:00";"2099-04-01 12:00"
            "aaaa1111";"ja";"3";"'{TAB}Tab";"";"";"";"x";"";"";"de";"2099-03-01 11:00";"2099-04-01 12:00"
            "aaaa1111";"ja";"4";"María-José García";"";"";"";"";"Nüsse";"";"de";"2099-03-01 11:00";"2099-04-01 12:00"

            """
            .ReplaceLineEndings("\r\n")
            .Replace("{LF}", "\n", StringComparison.Ordinal)
            .Replace("{CR}", "\r", StringComparison.Ordinal)
            .Replace("{TAB}", "\t", StringComparison.Ordinal);

        bytes.ShouldBe([0xEF, 0xBB, 0xBF, .. Encoding.UTF8.GetBytes(expected)]);
    }

    [Theory]
    [InlineData("=1+1", "\"'=1+1\"")]
    [InlineData("+1", "\"'+1\"")]
    [InlineData("-1", "\"'-1\"")]
    [InlineData("@SUM(A1)", "\"'@SUM(A1)\"")]
    [InlineData("\t=1", "\"'\t=1\"")]
    [InlineData("\r=1", "\"'\r=1\"")]
    [InlineData("a=1", "\"a=1\"")]
    [InlineData(" =1", "\" =1\"")]
    [InlineData("say \"hi\"", "\"say \"\"hi\"\"\"")]
    [InlineData("a;b", "\"a;b\"")]
    [InlineData("", "\"\"")]
    [InlineData(null, "\"\"")]
    public void EveryCellIsQuotedAndFormulaStartsArePrefixed(string? value, string expected)
    {
        RsvpCsv.Cell(value).ShouldBe(expected);
    }

    [Fact]
    public void AnEmptyExportHasOnlyTheHeader()
    {
        var text = RsvpCsv.ToText([], TimeZoneInfo.Utc);

        text.ShouldBe(string.Join(';', RsvpCsv.Header.Select(RsvpCsv.Cell)) + "\r\n");
    }

    private static RsvpRecord Record(
        string id,
        bool attending,
        DateTimeOffset created,
        DateTimeOffset updated,
        string? message,
        string language,
        params RsvpPerson[] people) =>
        new(id, new RsvpAnswer(attending, people, message, language), "hash", created, updated);

    private static RsvpPerson Person(string name, string? note, params string[] tags) => new("p" + name.Length, name, tags, note);
}
