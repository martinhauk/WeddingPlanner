using System.Text.Json;

using Azure;
using Azure.Data.Tables;

using WeddingPlanner.Domain.Rsvp;

namespace WeddingPlanner.Api.Storage.Rsvps;

/// <summary>
/// <see cref="IRsvpRepository"/> on Azure Table Storage. Entity layout (schema version 1):
/// <c>Attending</c> (bool), <c>People</c> (JSON array of <c>{id, name, tags, note}</c>), <c>PersonCount</c>,
/// <c>AttendingCount</c> (people coming: <c>PersonCount</c> for a yes, 0 for a no), <c>Message</c>,
/// <c>Language</c>, <c>TokenHash</c>, <c>CreatedAt</c>, <c>UpdatedAt</c>, <c>SchemaVersion</c>.
/// </summary>
public sealed class TableRsvpRepository(TableStorage storage) : IRsvpRepository
{
    /// <summary>Table name (before the optional prefix).</summary>
    public const string TableName = "Rsvps";

    /// <summary>The single partition of the table.</summary>
    public const string PartitionKey = "rsvp";

    private const int SchemaVersion = 1;

    private static readonly JsonSerializerOptions _peopleJson = new(JsonSerializerDefaults.Web);

    /// <inheritdoc/>
    public bool IsConfigured => storage.IsConfigured;

    /// <inheritdoc/>
    public async Task<StoredRsvp?> GetAsync(string id, CancellationToken cancellationToken)
    {
        var table = await GetTableAsync(cancellationToken);
        var response = await table.GetEntityIfExistsAsync<TableEntity>(PartitionKey, CheckId(id), cancellationToken: cancellationToken);
        return response.HasValue && response.Value is { } entity ? new StoredRsvp(ToRecord(entity), entity.ETag.ToString()) : null;
    }

    /// <inheritdoc/>
    public async Task<StoredRsvp> AddAsync(RsvpRecord record, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(record);

        var table = await GetTableAsync(cancellationToken);
        var response = await table.AddEntityAsync(ToEntity(record), cancellationToken);
        return new StoredRsvp(record, response.Headers.ETag?.ToString() ?? string.Empty);
    }

    /// <inheritdoc/>
    public async Task<StoredRsvp?> ReplaceAsync(RsvpRecord record, string ifMatch, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(record);
        ArgumentException.ThrowIfNullOrEmpty(ifMatch);

        var table = await GetTableAsync(cancellationToken);
        try
        {
            var response = await table.UpdateEntityAsync(ToEntity(record), new ETag(ifMatch), TableUpdateMode.Replace, cancellationToken);
            return new StoredRsvp(record, response.Headers.ETag?.ToString() ?? string.Empty);
        }
        catch (RequestFailedException exception) when (exception.Status == 404)
        {
            return null;
        }
        catch (RequestFailedException exception) when (exception.Status == 412)
        {
            throw new ConcurrencyConflictException("The reply was changed by another request.", exception);
        }
    }

    /// <inheritdoc/>
    public async Task<bool> DeleteAsync(string id, string ifMatch, CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrEmpty(ifMatch);

        var table = await GetTableAsync(cancellationToken);
        try
        {
            var response = await table.DeleteEntityAsync(PartitionKey, CheckId(id), new ETag(ifMatch), cancellationToken);
            return response.Status != 404;
        }
        catch (RequestFailedException exception) when (exception.Status == 404)
        {
            return false;
        }
        catch (RequestFailedException exception) when (exception.Status == 412)
        {
            throw new ConcurrencyConflictException("The reply was changed by another request.", exception);
        }
    }

    /// <inheritdoc/>
    public async Task<IReadOnlyList<StoredRsvp>> ListAsync(CancellationToken cancellationToken)
    {
        var table = await GetTableAsync(cancellationToken);
        var replies = new List<StoredRsvp>();
        var filter = TableClient.CreateQueryFilter($"PartitionKey eq {PartitionKey}");
        await foreach (var entity in table.QueryAsync<TableEntity>(filter, cancellationToken: cancellationToken))
        {
            replies.Add(new StoredRsvp(ToRecord(entity), entity.ETag.ToString()));
        }

        return replies;
    }

    /// <inheritdoc/>
    public async Task<int> CountAsync(CancellationToken cancellationToken)
    {
        var table = await GetTableAsync(cancellationToken);
        var count = 0;
        var filter = TableClient.CreateQueryFilter($"PartitionKey eq {PartitionKey}");
        await foreach (var _ in table.QueryAsync<TableEntity>(filter, select: ["RowKey"], cancellationToken: cancellationToken))
        {
            count++;
        }

        return count;
    }

    internal static TableEntity ToEntity(RsvpRecord record)
    {
        var answer = record.Answer;
        var people = answer.People
            .Select(person => new StoredPerson(
                person.Id ?? throw new InvalidOperationException("Every person needs an id before the reply is stored."),
                person.Name,
                person.DietaryTags,
                person.DietaryNote))
            .ToList();

        return new TableEntity(PartitionKey, CheckId(record.Id))
        {
            ["Attending"] = answer.Attending,
            ["People"] = JsonSerializer.Serialize(people, _peopleJson),
            ["PersonCount"] = people.Count,
            ["AttendingCount"] = answer.Attending ? people.Count : 0,
            ["Message"] = answer.Message,
            ["Language"] = answer.Language,
            ["TokenHash"] = record.TokenHash,
            ["CreatedAt"] = record.CreatedAt.ToUniversalTime(),
            ["UpdatedAt"] = record.UpdatedAt.ToUniversalTime(),
            ["SchemaVersion"] = SchemaVersion,
        };
    }

    internal static RsvpRecord ToRecord(TableEntity entity)
    {
        var people = JsonSerializer.Deserialize<List<StoredPerson>>(entity.GetString("People") ?? "[]", _peopleJson) ?? [];
        var answer = new RsvpAnswer(
            entity.GetBoolean("Attending") ?? false,
            people.Select(person => new RsvpPerson(person.Id, person.Name, person.Tags ?? [], person.Note)).ToList(),
            entity.GetString("Message"),
            entity.GetString("Language") ?? string.Empty);

        return new RsvpRecord(
            entity.RowKey,
            answer,
            entity.GetString("TokenHash") ?? string.Empty,
            entity.GetDateTimeOffset("CreatedAt") ?? DateTimeOffset.MinValue,
            entity.GetDateTimeOffset("UpdatedAt") ?? DateTimeOffset.MinValue);
    }

    private static string CheckId(string id)
    {
        // Row keys come from cookies: allow only the id format, never characters Table Storage treats specially.
        if (string.IsNullOrEmpty(id) || id.Length > 64 || !id.All(char.IsAsciiLetterOrDigit))
        {
            throw new ArgumentException("Invalid reply id.", nameof(id));
        }

        return id;
    }

    private Task<TableClient> GetTableAsync(CancellationToken cancellationToken) => storage.GetTableAsync(TableName, cancellationToken);

    private sealed record StoredPerson(string Id, string Name, IReadOnlyList<string>? Tags, string? Note);
}
