using Shouldly;

using WeddingPlanner.Domain.Rsvp;

using Xunit;

namespace WeddingPlanner.Domain.Tests.Rsvp;

public sealed class RsvpValidatorTests
{
    [Fact]
    public void AcceptsAValidYes()
    {
        var draft = Draft(
            people:
            [
                Person("Pablo Pérez", [DietaryTags.Vegetarian, DietaryTags.GlutenFree], "No nuts, please"),
                Person("María-José García", [DietaryTags.Vegan]),
            ],
            message: "¡Felicidades!",
            language: "es");

        var answer = Valid(draft);

        answer.Attending.ShouldBeTrue();
        answer.Language.ShouldBe("es");
        answer.Message.ShouldBe("¡Felicidades!");
        answer.People.Count.ShouldBe(2);
        answer.People[0].Name.ShouldBe("Pablo Pérez");
        answer.People[0].DietaryTags.ShouldBe([DietaryTags.Vegetarian, DietaryTags.GlutenFree]);
        answer.People[0].DietaryNote.ShouldBe("No nuts, please");
        answer.People[1].Name.ShouldBe("María-José García");
        answer.People[1].DietaryTags.ShouldBe([DietaryTags.Vegan]);
        answer.People[1].DietaryNote.ShouldBeNull();
    }

    [Fact]
    public void OrdersTagsCanonicallyWithoutDuplicates()
    {
        var answer = Valid(Draft(people: [Person("Anna", [DietaryTags.LactoseFree, DietaryTags.Vegan, DietaryTags.LactoseFree, DietaryTags.Vegetarian])]));

        answer.People[0].DietaryTags.ShouldBe([DietaryTags.Vegetarian, DietaryTags.Vegan, DietaryTags.LactoseFree]);
    }

    [Fact]
    public void RejectsUnknownTagsIncludingWrongCase()
    {
        var errors = Invalid(Draft(people: [Person("Anna", [DietaryTags.Vegan, "pescatarian", null, "Vegan"])]));

        errors.ShouldBe(
        [
            new("people[0].dietary.tags[1]", RsvpValidationCodes.UnknownTag),
            new("people[0].dietary.tags[2]", RsvpValidationCodes.UnknownTag),
            new("people[0].dietary.tags[3]", RsvpValidationCodes.UnknownTag),
        ]);
    }

    [Fact]
    public void AcceptsUpToTenTagEntries()
    {
        var tags = Enumerable.Repeat<string?>(DietaryTags.Vegan, RsvpLimits.MaxDietaryTagEntries).ToList();

        Valid(Draft(people: [Person("Anna", tags)])).People[0].DietaryTags.ShouldBe([DietaryTags.Vegan]);
    }

    [Fact]
    public void RejectsMoreThanTenTagEntriesWithOneError()
    {
        var tags = Enumerable.Repeat<string?>(null, 2000).ToList();

        var errors = Invalid(Draft(people: [Person("Anna", tags), Person("Ben", [DietaryTags.Vegan, .. tags])]));

        errors.ShouldBe(
        [
            new("people[0].dietary.tags", RsvpValidationCodes.TooMany),
            new("people[1].dietary.tags", RsvpValidationCodes.TooMany),
        ]);
    }

    [Fact]
    public void RejectsANameOfOnlyInvisibleCharacters()
    {
        var errors = Invalid(Draft(people: [Person("\u200B"), Person("\u200D\uFE0F"), Person("\u3164")]));

        errors.ShouldBe(
        [
            new("people[0].name", RsvpValidationCodes.Required),
            new("people[1].name", RsvpValidationCodes.Required),
            new("people[2].name", RsvpValidationCodes.Required),
        ]);
    }

    [Fact]
    public void DropsDietaryDataForANo()
    {
        var answer = Valid(Draft(attending: false, people: [Person("Ben", [DietaryTags.Vegan, "unknown"], "secret note")]));

        answer.Attending.ShouldBeFalse();
        answer.People[0].DietaryTags.ShouldBeEmpty();
        answer.People[0].DietaryNote.ShouldBeNull();
    }

    [Fact]
    public void ANoMayNameSeveralPeople()
    {
        var answer = Valid(Draft(attending: false, people: [Person("Pablo Pérez"), Person("María-José García"), Person("Jürgen Müller")]));

        answer.People.Select(person => person.Name).ShouldBe(["Pablo Pérez", "María-José García", "Jürgen Müller"]);
    }

    [Fact]
    public void RequiresAttending()
    {
        Invalid(Draft(attending: null)).ShouldBe([new("attending", RsvpValidationCodes.Required)]);
    }

    [Fact]
    public void RequiresAtLeastOnePerson()
    {
        Invalid(new RsvpDraft(true, null, null, "de", null)).ShouldBe([new("people", RsvpValidationCodes.Required)]);
        Invalid(Draft(people: [])).ShouldBe([new("people", RsvpValidationCodes.Required)]);
    }

    [Fact]
    public void AllowsTheGuestPlusFiveCompanions()
    {
        var people = Enumerable.Range(1, 6).Select(index => Person($"Guest {index}")).ToList();

        Valid(Draft(people: people)).People.Count.ShouldBe(6);
    }

    [Fact]
    public void RejectsMoreThanSixPeople()
    {
        var people = Enumerable.Range(1, 7).Select(index => Person($"Guest {index}")).ToList();

        Invalid(Draft(people: people)).ShouldBe([new("people", RsvpValidationCodes.TooMany)]);
    }

    [Fact]
    public void HonoursALowerCompanionLimit()
    {
        var limits = new RsvpLimits(maxCompanions: 2);

        RsvpValidator.Validate(Draft(people: [Person("Anna"), Person("Ben"), Person("Pablo")]), limits).IsValid.ShouldBeTrue();
        RsvpValidator.Validate(Draft(people: [Person("Anna"), Person("Ben"), Person("Pablo"), Person("Jürgen")]), limits).Errors
            .ShouldBe([new("people", RsvpValidationCodes.TooMany)]);
    }

    [Theory]
    [InlineData(-1)]
    [InlineData(6)]
    public void CompanionLimitStaysWithinTheProductLimit(int maxCompanions)
    {
        Should.Throw<ArgumentOutOfRangeException>(() => new RsvpLimits(maxCompanions));
    }

    [Fact]
    public void RequiresANameForEveryPerson()
    {
        var errors = Invalid(Draft(people: [Person("   "), null, Person(null), Person(char.ConvertFromUtf32(0x202E))]));

        errors.ShouldBe(
        [
            new("people[0].name", RsvpValidationCodes.Required),
            new("people[1]", RsvpValidationCodes.Required),
            new("people[2].name", RsvpValidationCodes.Required),
            new("people[3].name", RsvpValidationCodes.Required),
        ]);
    }

    [Fact]
    public void LimitsNamesToEightyCharactersAfterTrimming()
    {
        var eighty = new string('a', RsvpLimits.MaxNameLength);

        Valid(Draft(people: [Person($"   {eighty}   ")])).People[0].Name.ShouldBe(eighty);
        Invalid(Draft(people: [Person(eighty + "b")])).ShouldBe([new("people[0].name", RsvpValidationCodes.TooLong)]);
    }

    [Fact]
    public void AppliesTheNameRulesToEveryPerson()
    {
        var errors = Invalid(Draft(people: [Person(" A "), Person("12"), Person("anna@example.com"), Person("Visit example.com"), Person("Ben")]));

        errors.ShouldBe(
        [
            new("people[0].name", RsvpValidationCodes.TooShort),
            new("people[1].name", RsvpValidationCodes.Invalid),
            new("people[2].name", RsvpValidationCodes.Invalid),
            new("people[3].name", RsvpValidationCodes.Invalid),
        ]);
    }

    [Fact]
    public void CountsTheMinimumLengthAfterSanitising()
    {
        Invalid(Draft(people: [Person("A​")])).ShouldBe([new("people[0].name", RsvpValidationCodes.TooShort)]);
        Valid(Draft(people: [Person("Jo")])).People[0].Name.ShouldBe("Jo");
    }

    [Fact]
    public void RejectsTheSameNameTwiceInOneReplyIgnoringCaseAndDiacritics()
    {
        var errors = Invalid(Draft(people:
        [
            Person("María-José García"),
            Person("Pablo Pérez"),
            Person("maria jose GARCIA"),
            Person("PABLO PEREZ"),
            Person("Jürgen Müller"),
        ]));

        errors.ShouldBe(
        [
            new("people[2].name", RsvpValidationCodes.Duplicate),
            new("people[3].name", RsvpValidationCodes.Duplicate),
        ]);
    }

    [Fact]
    public void ReportsADuplicateForANoAsWell()
    {
        Invalid(Draft(attending: false, people: [Person("Ben"), Person(" ben ")]))
            .ShouldBe([new("people[1].name", RsvpValidationCodes.Duplicate)]);
    }

    [Fact]
    public void AnInvalidNameIsNotAlsoADuplicate()
    {
        Invalid(Draft(people: [Person("A"), Person("a")]))
            .ShouldBe([new("people[0].name", RsvpValidationCodes.TooShort), new("people[1].name", RsvpValidationCodes.TooShort)]);
    }

    [Fact]
    public void LimitsNotesToTwoHundredCharacters()
    {
        Valid(Draft(people: [Person("Anna", note: new string('n', RsvpLimits.MaxNoteLength))])).People[0].DietaryNote.ShouldNotBeNull().Length.ShouldBe(200);
        Invalid(Draft(people: [Person("Anna", note: new string('n', RsvpLimits.MaxNoteLength + 1))]))
            .ShouldBe([new("people[0].dietary.note", RsvpValidationCodes.TooLong)]);
    }

    [Fact]
    public void LimitsTheMessageToOneThousandCharacters()
    {
        Valid(Draft(message: new string('m', RsvpLimits.MaxMessageLength))).Message.ShouldNotBeNull().Length.ShouldBe(1000);
        Invalid(Draft(message: new string('m', RsvpLimits.MaxMessageLength + 1))).ShouldBe([new("message", RsvpValidationCodes.TooLong)]);
    }

    [Fact]
    public void BlankTextBecomesNull()
    {
        var answer = Valid(Draft(people: [Person("Anna", note: "  \t ")], message: " \r\n "));

        answer.Message.ShouldBeNull();
        answer.People[0].DietaryNote.ShouldBeNull();
    }

    [Fact]
    public void SanitizesNamesAndTheMessage()
    {
        var answer = Valid(Draft(people: [Person("  Jürgen" + char.ConvertFromUtf32(0x202E) + "  Müller ")], message: "Hola\r\nAnna "));

        answer.People[0].Name.ShouldBe("Jürgen Müller");
        answer.Message.ShouldBe("Hola\nAnna");
    }

    [Theory]
    [InlineData("de", "de")]
    [InlineData(" EN ", "en")]
    [InlineData("es-ES", "es-es")]
    [InlineData("gsw", "gsw")]
    public void NormalizesTheLanguage(string language, string expected)
    {
        Valid(Draft(language: language)).Language.ShouldBe(expected);
    }

    [Theory]
    [InlineData(null, RsvpValidationCodes.Required)]
    [InlineData("  ", RsvpValidationCodes.Required)]
    [InlineData("d", RsvpValidationCodes.Invalid)]
    [InlineData("german", RsvpValidationCodes.Invalid)]
    [InlineData("de_DE", RsvpValidationCodes.Invalid)]
    [InlineData("de-<script>", RsvpValidationCodes.Invalid)]
    public void RejectsMissingOrMalformedLanguages(string? language, string code)
    {
        Invalid(Draft(language: language)).ShouldBe([new("language", code)]);
    }

    [Fact]
    public void RejectsAFilledHoneypot()
    {
        Invalid(Draft(website: "https://spam.example.com")).ShouldBe([new("website", RsvpValidationCodes.MustBeEmpty)]);
        Valid(Draft(website: "  "));
    }

    [Fact]
    public void PassesValidPersonIdsThroughAndRejectsMalformedOnes()
    {
        Valid(Draft(people: [Person("Anna", id: "a1b2c3d4")])).People[0].Id.ShouldBe("a1b2c3d4");
        Invalid(Draft(people: [Person("Anna", id: "not an id!")])).ShouldBe([new("people[0].id", RsvpValidationCodes.Invalid)]);
    }

    [Fact]
    public void ReportsEveryErrorAtOnce()
    {
        var errors = Invalid(new RsvpDraft(null, [Person("", ["fish"])], new string('m', 1001), "xx-", "bot"));

        errors.Select(error => error.Field).ShouldBe(
            ["website", "attending", "people[0].name", "message", "language"],
            ignoreOrder: true);
    }

    [Fact]
    public void ToStringPrintsNoPersonalData()
    {
        var person = Person("Pablo Pérez", note: "secret note");
        var draft = Draft(people: [person], message: "private message");
        var answer = Valid(draft);

        foreach (var text in new[] { draft.ToString(), person.ToString(), answer.ToString(), answer.People[0].ToString() })
        {
            text.ShouldNotContain("Pablo");
            text.ShouldNotContain("secret");
            text.ShouldNotContain("private");
        }
    }

    private static RsvpDraftPerson Person(string? name, IReadOnlyList<string?>? tags = null, string? note = null, string? id = null) =>
        new(id, name, tags, note);

    private static RsvpDraft Draft(
        bool? attending = true,
        IReadOnlyList<RsvpDraftPerson?>? people = null,
        string? message = null,
        string? language = "de",
        string? website = null) =>
        new(attending, people ?? [Person("Pablo Pérez")], message, language, website);

    private static RsvpAnswer Valid(RsvpDraft draft)
    {
        var result = RsvpValidator.Validate(draft, RsvpLimits.Default);
        result.Errors.ShouldBeEmpty();
        return result.Answer.ShouldNotBeNull();
    }

    private static IReadOnlyList<RsvpValidationError> Invalid(RsvpDraft draft)
    {
        var result = RsvpValidator.Validate(draft, RsvpLimits.Default);
        result.IsValid.ShouldBeFalse();
        result.Answer.ShouldBeNull();
        return result.Errors;
    }
}
