using Shouldly;

using WeddingPlanner.Domain.Rsvp;

using Xunit;

namespace WeddingPlanner.Domain.Tests.Rsvp;

public sealed class PersonNamesTests
{
    [Theory]
    [InlineData("Anna")]
    [InlineData("Ben")]
    [InlineData("Jo")]
    [InlineData("A.")]
    [InlineData("Pablo Pérez")]
    [InlineData("María-José García")]
    [InlineData("Jürgen Müller")]
    [InlineData("O'Brien")]
    [InlineData("Dr. med. Anna Müller")]
    [InlineData("Dr.med. Anna Müller")]
    [InlineData("J.R.R. Ben")]
    [InlineData("Prof. Dr. Ben")]
    [InlineData("Anna (Ben's sister)")]
    [InlineData("Ben & Anna")]
    [InlineData("Ben 2")]
    [InlineData("Ana María de la Cruz")]
    [InlineData("Ana M. de la Cruz")]
    [InlineData("Müller-Lüdenscheidt")]
    [InlineData("李明")]
    [InlineData("Ελένη")]
    [InlineData("Анна")]
    public void AcceptsRealNames(string name)
    {
        PersonNames.Check(name).ShouldBeNull();
    }

    [Theory]
    [InlineData("A")]
    [InlineData("é")]
    [InlineData("李")]
    [InlineData("😀")]
    public void RejectsNamesShorterThanTwoCharacters(string name)
    {
        PersonNames.Check(name).ShouldBe(RsvpValidationCodes.TooShort);
    }

    [Theory]
    [InlineData("12")]
    [InlineData("=1+1")]
    [InlineData("...")]
    [InlineData("😀😀")]
    [InlineData("-- --")]
    public void RejectsNamesWithoutALetter(string name)
    {
        PersonNames.Check(name).ShouldBe(RsvpValidationCodes.Invalid);
    }

    [Theory]
    [InlineData("anna@example.com")]
    [InlineData("Anna @ben")]
    [InlineData("Anna＠example")]
    [InlineData("https://example.com")]
    [InlineData("Anna HTTP://EXAMPLE")]
    [InlineData("ftp://x")]
    [InlineData("Anna www.example")]
    [InlineData("WWW.EXAMPLE")]
    [InlineData("example.com")]
    [InlineData("Buy cheap at example.com now")]
    [InlineData("Anna (example.org/offer)")]
    [InlineData("bit.ly")]
    [InlineData("mail.example.co.uk")]
    [InlineData("Anna example.xyz?ref=1")]
    public void RejectsWebAddressesAndAtSigns(string name)
    {
        PersonNames.Check(name).ShouldBe(RsvpValidationCodes.Invalid);
    }

    [Theory]
    [InlineData("María-José García", "maria jose GARCIA")]
    [InlineData("Pablo Pérez", "PABLO PEREZ")]
    [InlineData("Jürgen Müller", "Jurgen  Muller")]
    [InlineData("O'Brien", "o brien")]
    [InlineData("Anna-Ben", "Anna Ben")]
    [InlineData("Anna.", "anna")]
    public void FoldsCaseDiacriticsAndPunctuationForTheDuplicateCheck(string first, string second)
    {
        PersonNames.DuplicateKey(first).ShouldBe(PersonNames.DuplicateKey(second));
    }

    [Theory]
    [InlineData("Jürgen Müller", "Juergen Mueller")]
    [InlineData("Anna", "Ana")]
    [InlineData("Ben 1", "Ben 2")]
    [InlineData("Anna Ben", "Ben Anna")]
    public void KeepsDifferentNamesApart(string first, string second)
    {
        PersonNames.DuplicateKey(first).ShouldNotBe(PersonNames.DuplicateKey(second));
    }

    [Fact]
    public void TheDuplicateKeyIsLowerCaseWithSingleSpaces()
    {
        PersonNames.DuplicateKey("  María-José   García! ").ShouldBe("maria jose garcia");
    }
}
