using Shouldly;

using WeddingPlanner.Domain.Rsvp;

using Xunit;

namespace WeddingPlanner.Domain.Tests.Rsvp;

public sealed class PersonIdsTests
{
    [Fact]
    public void NewIdsAreEightRandomHexCharacters()
    {
        var ids = Enumerable.Range(0, 100).Select(_ => PersonIds.NewId()).ToList();

        ids.ShouldAllBe(id => id.Length == 8 && id.All(c => char.IsAsciiDigit(c) || (c >= 'a' && c <= 'f')));
        ids.ShouldAllBe(id => PersonIds.IsValid(id));
        ids.Distinct().Count().ShouldBeGreaterThan(95);
    }

    [Theory]
    [InlineData("a1b2c3d4", true)]
    [InlineData("A_b-9", true)]
    [InlineData("", false)]
    [InlineData(null, false)]
    [InlineData("has space", false)]
    [InlineData("a/b", false)]
    [InlineData("0123456789abcdef0123456789abcdef0", false)]
    public void ValidatesTheIdFormat(string? id, bool valid)
    {
        PersonIds.IsValid(id).ShouldBe(valid);
    }

    [Fact]
    public void GivesEveryPersonOfANewReplyAFreshId()
    {
        var answer = Answer(("Pablo Pérez", "client-chosen"), ("María-José García", null));

        var assigned = PersonIds.Assign(answer, [], Sequence("p1", "p2"));

        assigned.People.Select(person => person.Id).ShouldBe(["p1", "p2"]);
        assigned.People.Select(person => person.Name).ShouldBe(["Pablo Pérez", "María-José García"]);
    }

    [Fact]
    public void KeepsKnownIdsOnUpdate()
    {
        var answer = Answer(("María-José García", "b2"), ("Jürgen Müller", null), ("Pablo Pérez", "a1"));

        var assigned = PersonIds.Assign(answer, ["a1", "b2"], Sequence("c3"));

        assigned.People.Select(person => person.Id).ShouldBe(["b2", "c3", "a1"]);
    }

    [Fact]
    public void ADuplicatedIdIsKeptOnlyOnce()
    {
        var answer = Answer(("Anna", "a1"), ("Ben", "a1"));

        var assigned = PersonIds.Assign(answer, ["a1"], Sequence("n1"));

        assigned.People.Select(person => person.Id).ShouldBe(["a1", "n1"]);
    }

    [Fact]
    public void NeverReusesTheIdOfARemovedPersonOrAnIdInUse()
    {
        // "gone" belonged to a person who was removed; "a1" is still in the reply.
        var answer = Answer(("Anna", "a1"), ("Ben", null));

        var assigned = PersonIds.Assign(answer, ["a1", "gone"], Sequence("gone", "a1", "fresh"));

        assigned.People.Select(person => person.Id).ShouldBe(["a1", "fresh"]);
    }

    private static RsvpAnswer Answer(params (string Name, string? Id)[] people) =>
        new(true, people.Select(person => new RsvpPerson(person.Id, person.Name, [], null)).ToList(), null, "de");

    private static Func<string> Sequence(params string[] ids)
    {
        var queue = new Queue<string>(ids);
        return queue.Dequeue;
    }
}
