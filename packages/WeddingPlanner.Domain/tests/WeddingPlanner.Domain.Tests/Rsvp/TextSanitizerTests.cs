using Shouldly;

using WeddingPlanner.Domain.Rsvp;

using Xunit;

namespace WeddingPlanner.Domain.Tests.Rsvp;

public sealed class TextSanitizerTests
{
    [Fact]
    public void NullBecomesEmpty()
    {
        TextSanitizer.SingleLine(null).ShouldBe(string.Empty);
        TextSanitizer.MultiLine(null).ShouldBe(string.Empty);
    }

    [Fact]
    public void SingleLineTrimsAndCollapsesWhitespace()
    {
        TextSanitizer.SingleLine("  Pablo \t  Pérez \n").ShouldBe("Pablo Pérez");
    }

    [Fact]
    public void SingleLineTurnsLineBreaksIntoSpaces()
    {
        TextSanitizer.SingleLine("María-José\r\nGarcía").ShouldBe("María-José García");
        TextSanitizer.SingleLine("Anna" + C(0x2028) + "Ben" + C(0x0085) + "!").ShouldBe("Anna Ben !");
    }

    [Fact]
    public void SingleLineTurnsOtherSpacesIntoOneSpace()
    {
        TextSanitizer.SingleLine("Jürgen" + C(0x00A0) + C(0x3000) + "Müller").ShouldBe("Jürgen Müller");
    }

    [Theory]
    [InlineData(0x061C)]
    [InlineData(0x200E)]
    [InlineData(0x200F)]
    [InlineData(0x202A)]
    [InlineData(0x202B)]
    [InlineData(0x202C)]
    [InlineData(0x202D)]
    [InlineData(0x202E)]
    [InlineData(0x2066)]
    [InlineData(0x2067)]
    [InlineData(0x2068)]
    [InlineData(0x2069)]
    public void StripsBidiControls(int codePoint)
    {
        TextSanitizer.IsBidiControl((char)codePoint).ShouldBeTrue();
        TextSanitizer.SingleLine("Anna" + C(codePoint) + "Ben").ShouldBe("AnnaBen");
        TextSanitizer.MultiLine("Anna" + C(codePoint) + "Ben").ShouldBe("AnnaBen");
    }

    [Theory]
    [InlineData(0x0000)]
    [InlineData(0x0007)]
    [InlineData(0x001B)]
    [InlineData(0x007F)]
    [InlineData(0x0080)]
    [InlineData(0x009F)]
    [InlineData(0xFEFF)]
    public void StripsControlCharactersAndTheByteOrderMark(int codePoint)
    {
        TextSanitizer.SingleLine("Anna" + C(codePoint) + "Ben").ShouldBe("AnnaBen");
        TextSanitizer.MultiLine("Anna" + C(codePoint) + "Ben").ShouldBe("AnnaBen");
    }

    [Theory]
    [InlineData(0xFFFE)]
    [InlineData(0xFFFF)]
    [InlineData(0xFDD0)]
    [InlineData(0xFDEF)]
    [InlineData(0x1FFFE)]
    [InlineData(0x1FFFF)]
    [InlineData(0x10FFFE)]
    [InlineData(0x10FFFF)]
    public void StripsNoncharacters(int codePoint)
    {
        TextSanitizer.IsNoncharacter(codePoint).ShouldBeTrue();
        TextSanitizer.SingleLine("Anna" + C(codePoint) + "Ben").ShouldBe("AnnaBen");
        TextSanitizer.MultiLine("Hallo" + C(codePoint) + "\nBen").ShouldBe("Hallo\nBen");
        TextSanitizer.SingleLine(C(codePoint)).ShouldBe(string.Empty);
    }

    [Theory]
    [InlineData(0xFDCF)]
    [InlineData(0xFDF0)]
    [InlineData(0xFFFD)]
    [InlineData(0x1FFFD)]
    [InlineData(0x20000)]
    public void KeepsCharactersNextToTheNoncharacterRanges(int codePoint)
    {
        TextSanitizer.IsNoncharacter(codePoint).ShouldBeFalse();
        TextSanitizer.SingleLine("Anna" + C(codePoint)).ShouldBe("Anna" + C(codePoint));
    }

    [Fact]
    public void NeverThrowsForAnyCodeUnitOrCodePoint()
    {
        for (var unit = 0; unit <= 0xFFFF; unit++)
        {
            var text = "A" + (char)unit + "e" + C(0x0301);
            Should.NotThrow(() => TextSanitizer.SingleLine(text));
            Should.NotThrow(() => TextSanitizer.MultiLine(text));
        }

        for (var plane = 1; plane <= 0x10; plane++)
        {
            foreach (var low in new[] { 0x0000, 0xFFFD, 0xFFFE, 0xFFFF })
            {
                var text = "A" + C((plane << 16) | low);
                Should.NotThrow(() => TextSanitizer.SingleLine(text));
            }
        }
    }

    [Fact]
    public void RemovesLoneSurrogatesButKeepsPairs()
    {
        var party = C(0x1F389);
        var input = "Anna" + (char)0xD800 + "Ben" + (char)0xDC00 + party;

        TextSanitizer.SingleLine(input).ShouldBe("AnnaBen" + party);
    }

    [Fact]
    public void KeepsJoinersInEmojiSequences()
    {
        var couple = C(0x1F469) + C(0x200D) + C(0x2764) + C(0xFE0F) + C(0x200D) + C(0x1F468);

        TextSanitizer.SingleLine(couple).ShouldBe(couple);
    }

    [Fact]
    public void NormalizesToComposedForm()
    {
        var decomposed = "Pe" + "r" + "e" + C(0x0301) + "z";
        var composed = "Per" + C(0x00E9) + "z";

        TextSanitizer.SingleLine(decomposed).ShouldBe(composed);
        TextSanitizer.MultiLine(decomposed).ShouldBe(composed);
    }

    [Fact]
    public void MultiLineKeepsLineBreaksAsLineFeeds()
    {
        TextSanitizer.MultiLine("Hola\r\nAnna\rand Ben" + C(0x2028) + "!").ShouldBe("Hola\nAnna\nand Ben\n!");
    }

    [Fact]
    public void MultiLineTrimsTrailingWhitespaceOfLinesAndTheText()
    {
        TextSanitizer.MultiLine("  \n Dear Anna,  \n\n  See you!\t \n\n").ShouldBe("Dear Anna,\n\n  See you!");
    }

    [Fact]
    public void MultiLineTurnsTabsIntoSpaces()
    {
        TextSanitizer.MultiLine("a\tb").ShouldBe("a b");
    }

    [Fact]
    public void OnlyInvisibleCharactersBecomeEmpty()
    {
        TextSanitizer.SingleLine(C(0x202E) + " " + C(0x200E) + "\t").ShouldBe(string.Empty);
        TextSanitizer.MultiLine("\n" + C(0x2066) + "\r\n").ShouldBe(string.Empty);
    }

    private static string C(int codePoint) => char.ConvertFromUtf32(codePoint);
}
