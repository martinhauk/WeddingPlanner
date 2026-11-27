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
    [InlineData("Dr.med.vet.")]
    [InlineData("Dr.med.vet. Anna Example")]
    [InlineData("Dr. med. dent. Anna Example")]
    [InlineData("Prof.Dr. Ben Example")]
    [InlineData("Anna B.Sc.")]
    [InlineData("Dr.in Anna Example")]
    [InlineData("Dr.-Ing. Ben Example")]
    [InlineData("Dr.rer.nat. Ben Example")]
    [InlineData("Mag.art. Anna Example")]
    [InlineData("Lic.De la Cruz")]
    [InlineData("Ana M.De la Cruz")]
    [InlineData("Mª.de los Ángeles")]
    [InlineData("lic.de la cruz")]
    [InlineData("Jürgen v.de Berg")]
    [InlineData("MA.DE LOS ANGELES")]
    [InlineData("J.de Vries")]
    [InlineData("Wei J.LI")]
    [InlineData("Anna Lu")]
    [InlineData("J.Lu")]
    [InlineData("Dr.LI")]
    [InlineData("Dr.LI.")]
    [InlineData("Prof.Dr.LI")]
    [InlineData("Dr.med.LI")]
    [InlineData("Begleitung von Dr.LI")]
    [InlineData("Mr.LI")]
    [InlineData("Mrs.HU")]
    [InlineData("Ms.LU")]
    [InlineData("Dr.LY")]
    [InlineData("DR.LI")]
    [InlineData("prof.lu")]
    [InlineData("DR.PAGE")]
    [InlineData("DR.LINK")]
    [InlineData("Dr.RO")]
    [InlineData("Yuki.AI")]
    [InlineData("HR.U.FR. MÜLLER")]
    [InlineData("HR.U.FR.MÜLLER")]
    [InlineData("hr.u.fr. müller")]
    [InlineData("JOH.FR. MÜLLER")]
    [InlineData("joh.fr. müller")]
    [InlineData("J.FR. Müller")]
    [InlineData("CHR.FR. MÜLLER")]
    [InlineData("FR.CH. MÜLLER")]
    [InlineData("fr.ch. müller")]
    [InlineData("a.ch. müller")]
    [InlineData("M.ASIA EXAMPLE")]
    [InlineData("m.asia example")]
    [InlineData("J.LINK")]
    [InlineData("B.PAGE")]
    [InlineData("B.DEV")]
    [InlineData("J.RO")]
    [InlineData("J.BR.")]
    [InlineData("Ana M.ES")]
    [InlineData("Wei J.SU")]
    [InlineData("J.Bar")]
    [InlineData("Avv.to Pablo Pérez")]
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
    [InlineData("bit.ly/x")]
    [InlineData("www.example.de")]
    [InlineData("spam.shop")]
    [InlineData("x.io")]
    [InlineData("http://a")]
    [InlineData("EXAMPLE.COM")]
    [InlineData("Anna example.de/")]
    [InlineData("example.de")]
    [InlineData("EXAMPLE.DE")]
    [InlineData("shop.de?x")]
    [InlineData("Anna (example.de)")]
    [InlineData("example.ai:8080")]
    [InlineData("Ben ab.cd.example.es")]
    [InlineData("Anna x-y.online")]
    [InlineData("Anna ://")]
    [InlineData("example.bond")]
    [InlineData("Anna example-pills.bond")]
    [InlineData("Ben (example.lol)")]
    [InlineData("example.lol/x?y=1")]
    [InlineData("example.su")]
    [InlineData("example.to")]
    [InlineData("example.fr")]
    [InlineData("EXAMPLE.CH")]
    [InlineData("example.asia")]
    [InlineData("x.ly/abc")]
    [InlineData("x.ai/x")]
    [InlineData("J.de/x")]
    [InlineData("example.gl/x")]
    [InlineData("example.in/x")]
    [InlineData("EXAMPLE.COM/X")]
    [InlineData("example.de\u200D")]
    [InlineData("example.de\u200C")]
    [InlineData("example.de\uFE0F")]
    [InlineData("example.ai\u034F")]
    [InlineData("example.de\u2800")]
    [InlineData("Ben example.de 💍")]
    [InlineData("Ben example.de €")]
    [InlineData("example.cOM")]
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
