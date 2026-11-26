using Azure.Data.Tables;

using Shouldly;

using WeddingPlanner.Api.Storage;
using WeddingPlanner.Api.Storage.Rsvps;
using WeddingPlanner.Domain.Rsvp;

using Xunit;

namespace WeddingPlanner.Api.Tests.Integration;

/// <summary>The RSVP repository against Azurite (<c>pnpm storage:up</c>).</summary>
[Trait("Category", "Integration")]
public sealed class TableRsvpRepositoryTests
{
    private static readonly DateTimeOffset _created = new(2099, 4, 1, 10, 0, 0, TimeSpan.Zero);

    [Fact]
    public async Task StoresAndReadsAReply()
    {
        await using var store = new AzuriteRsvpStore();
        var repository = store.Repository;
        var record = Record("0123456789abcdef0123456789abcdef");

        var added = await Azurite.CallAsync(() => repository.AddAsync(record, Token));
        var read = await repository.GetAsync(record.Id, Token);

        added.ETag.ShouldNotBeNullOrEmpty();
        read.ShouldNotBeNull().ETag.ShouldBe(added.ETag);
        var answer = read.Record.Answer;
        answer.Attending.ShouldBeTrue();
        answer.Language.ShouldBe("es");
        answer.Message.ShouldBe("¡Felicidades!\nAnna y Ben");
        answer.People.Select(person => (person.Id, person.Name)).ShouldBe([("p1", "Pablo Pérez"), ("p2", "María-José García")]);
        answer.People[0].DietaryTags.ShouldBe([DietaryTags.Vegetarian, DietaryTags.GlutenFree]);
        answer.People[0].DietaryNote.ShouldBe("Sin nueces");
        answer.People[1].DietaryTags.ShouldBeEmpty();
        answer.People[1].DietaryNote.ShouldBeNull();
        read.Record.TokenHash.ShouldBe(record.TokenHash);
        read.Record.CreatedAt.ShouldBe(_created);
        read.Record.UpdatedAt.ShouldBe(_created);
        read.Record.DietaryConsent.ShouldBeTrue();
    }

    [Fact]
    public async Task StoresTheDocumentedEntityLayoutAndNothingElse()
    {
        await using var store = new AzuriteRsvpStore();
        var record = Record("11111111111111111111111111111111");
        await Azurite.CallAsync(() => store.Repository.AddAsync(record, Token));

        var entity = (await store.Table.GetEntityAsync<TableEntity>(TableRsvpRepository.PartitionKey, record.Id, cancellationToken: Token)).Value;

        entity.Keys.Where(key => key is not ("PartitionKey" or "RowKey" or "Timestamp" or "odata.etag")).Order().ShouldBe(
            ["Attending", "AttendingCount", "CreatedAt", "DietaryConsent", "Language", "Message", "People", "PersonCount", "SchemaVersion", "TokenHash", "UpdatedAt"]);
        entity.GetInt32("PersonCount").ShouldBe(2);
        entity.GetInt32("AttendingCount").ShouldBe(2);
        entity.GetString("TokenHash").ShouldBe(record.TokenHash);
    }

    [Fact]
    public async Task ReturnsNullForAnUnknownReply()
    {
        await using var store = new AzuriteRsvpStore();

        (await Azurite.CallAsync(() => store.Repository.GetAsync("22222222222222222222222222222222", Token))).ShouldBeNull();
    }

    [Fact]
    public async Task ReplacesWithTheCurrentETagAndRejectsAStaleOne()
    {
        await using var store = new AzuriteRsvpStore();
        var repository = store.Repository;
        var record = Record("33333333333333333333333333333333");
        var added = await Azurite.CallAsync(() => repository.AddAsync(record, Token));
        var changed = record with
        {
            Answer = record.Answer with { Attending = false, People = [new RsvpPerson("p1", "Pablo Pérez", [], null)] },
            UpdatedAt = _created.AddHours(1),
        };

        var replaced = (await repository.ReplaceAsync(changed, added.ETag, Token)).ShouldNotBeNull();

        replaced.ETag.ShouldNotBe(added.ETag);
        var read = (await repository.GetAsync(record.Id, Token)).ShouldNotBeNull();
        read.Record.Answer.Attending.ShouldBeFalse();
        read.Record.Answer.People.ShouldHaveSingleItem();
        read.Record.UpdatedAt.ShouldBe(_created.AddHours(1));
        await Should.ThrowAsync<ConcurrencyConflictException>(() => repository.ReplaceAsync(record, added.ETag, Token));
    }

    [Fact]
    public async Task ReplaceOfADeletedReplyReturnsNull()
    {
        await using var store = new AzuriteRsvpStore();
        var record = Record("44444444444444444444444444444444");
        await Azurite.CallAsync(() => store.Repository.CountAsync(Token));

        (await store.Repository.ReplaceAsync(record, "*", Token)).ShouldBeNull();
    }

    [Fact]
    public async Task DeletesWithTheCurrentETagOnly()
    {
        await using var store = new AzuriteRsvpStore();
        var repository = store.Repository;
        var record = Record("55555555555555555555555555555555");
        var added = await Azurite.CallAsync(() => repository.AddAsync(record, Token));
        var replaced = (await repository.ReplaceAsync(record, added.ETag, Token)).ShouldNotBeNull();

        await Should.ThrowAsync<ConcurrencyConflictException>(() => repository.DeleteAsync(record.Id, added.ETag, Token));
        (await repository.DeleteAsync(record.Id, replaced.ETag, Token)).ShouldBeTrue();
        (await repository.GetAsync(record.Id, Token)).ShouldBeNull();
        (await repository.DeleteAsync(record.Id, "*", Token)).ShouldBeFalse();
    }

    [Fact]
    public async Task CountsTheReplies()
    {
        await using var store = new AzuriteRsvpStore();
        var repository = store.Repository;
        (await Azurite.CallAsync(() => repository.CountAsync(Token))).ShouldBe(0);

        await repository.AddAsync(Record("66666666666666666666666666666666"), Token);
        await repository.AddAsync(Record("77777777777777777777777777777777"), Token);

        (await repository.CountAsync(Token)).ShouldBe(2);
    }

    [Theory]
    [InlineData("")]
    [InlineData("a/b")]
    [InlineData("a'b")]
    [InlineData("a#b")]
    public async Task RejectsIdsThatAreNotPlainKeys(string id)
    {
        await using var store = new AzuriteRsvpStore();

        await Should.ThrowAsync<ArgumentException>(() => store.Repository.GetAsync(id, Token));
    }

    private static CancellationToken Token => TestContext.Current.CancellationToken;

    private static RsvpRecord Record(string id) => new(
        id,
        new RsvpAnswer(
            true,
            [
                new RsvpPerson("p1", "Pablo Pérez", [DietaryTags.Vegetarian, DietaryTags.GlutenFree], "Sin nueces"),
                new RsvpPerson("p2", "María-José García", [], null),
            ],
            "¡Felicidades!\nAnna y Ben",
            "es"),
        new string('a', 64),
        _created,
        _created,
        DietaryConsent: true);
}
