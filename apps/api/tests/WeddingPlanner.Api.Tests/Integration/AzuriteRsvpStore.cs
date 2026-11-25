using Azure;
using Azure.Data.Tables;

using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

using WeddingPlanner.Api.Storage;
using WeddingPlanner.Api.Storage.Rsvps;

namespace WeddingPlanner.Api.Tests.Integration;

/// <summary>
/// A <see cref="TableRsvpRepository"/> on Azurite with a random table prefix (see <see cref="Azurite"/>). Disposing it
/// deletes the table, so parallel worktrees and CI jobs never see each other's data.
/// </summary>
internal sealed class AzuriteRsvpStore : IAsyncDisposable
{
    private readonly TableServiceClient _service;

    public AzuriteRsvpStore()
    {
        // Validates that the connection string points at a loopback endpoint before anything else uses it.
        _service = Azurite.CreateTableServiceClient();
        TablePrefix = Azurite.NewTablePrefix();
        var options = Options.Create(new StorageOptions { ConnectionString = Azurite.ConnectionString, TablePrefix = TablePrefix });
        Repository = new TableRsvpRepository(new TableStorage(options, NullLogger<TableStorage>.Instance));
    }

    public string TablePrefix { get; }

    public string TableName => TablePrefix + TableRsvpRepository.TableName;

    public TableRsvpRepository Repository { get; }

    /// <summary>The raw table, to inspect exactly what is stored.</summary>
    public TableClient Table => _service.GetTableClient(TableName);

    public async ValueTask DisposeAsync()
    {
        try
        {
            await _service.DeleteTableAsync(TableName);
        }
        catch (RequestFailedException)
        {
            // Cleanup must not hide the original failure.
        }
    }
}
