using System.Collections.Concurrent;

using Azure.Data.Tables;

using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace WeddingPlanner.Api.Storage;

/// <summary>
/// Lazy access to the tables (ADR 0002). Nothing happens at startup: the client is created on first use, and
/// each table is created if missing on its first use per process (Bicep creates them in Azure; Azurite starts
/// empty). The connection string is never logged.
/// </summary>
public sealed partial class TableStorage
{
    private readonly Lazy<TableServiceClient?> _service;
    private readonly string _tablePrefix;
    private readonly ConcurrentDictionary<string, Lazy<Task<TableClient>>> _tables = new(StringComparer.Ordinal);

    public TableStorage(IOptions<StorageOptions> options, ILogger<TableStorage> logger)
    {
        ArgumentNullException.ThrowIfNull(options);
        ArgumentNullException.ThrowIfNull(logger);

        var settings = options.Value;
        _tablePrefix = settings.TablePrefix;
        _service = new Lazy<TableServiceClient?>(() => CreateClient(settings, logger));
    }

    /// <summary>
    /// Whether a usable connection string and table prefix are configured. Evaluated once, without network I/O.
    /// </summary>
    public bool IsConfigured => _service.Value is not null;

    /// <summary>Returns the client of table <paramref name="name"/> (with the prefix), creating the table if missing.</summary>
    /// <exception cref="InvalidOperationException">Storage is not configured (check <see cref="IsConfigured"/> first).</exception>
    public async Task<TableClient> GetTableAsync(string name, CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrEmpty(name);
        var service = _service.Value ?? throw new InvalidOperationException("Storage is not configured.");

        var lazy = _tables.GetOrAdd(name, tableName => new Lazy<Task<TableClient>>(() => CreateTableAsync(service, _tablePrefix + tableName)));
        try
        {
            return await lazy.Value.WaitAsync(cancellationToken);
        }
        catch when (lazy.Value.IsFaulted || lazy.Value.IsCanceled)
        {
            // Let the next call try again instead of caching the failure for the life of the process.
            _tables.TryRemove(new KeyValuePair<string, Lazy<Task<TableClient>>>(name, lazy));
            throw;
        }
    }

    private static async Task<TableClient> CreateTableAsync(TableServiceClient service, string tableName)
    {
        var table = service.GetTableClient(tableName);
        await table.CreateIfNotExistsAsync(CancellationToken.None);
        return table;
    }

    private static TableServiceClient? CreateClient(StorageOptions settings, ILogger logger)
    {
        if (string.IsNullOrWhiteSpace(settings.ConnectionString))
        {
            LogNotConfigured(logger, "Storage__ConnectionString is missing");
            return null;
        }

        if (settings.TablePrefix.Length > 0 && !(char.IsAsciiLetter(settings.TablePrefix[0]) && settings.TablePrefix.All(char.IsAsciiLetterOrDigit)))
        {
            LogNotConfigured(logger, "Storage__TablePrefix must contain only letters and digits and start with a letter");
            return null;
        }

        try
        {
            var options = new TableClientOptions();
            options.Retry.MaxRetries = 2;
            options.Retry.NetworkTimeout = TimeSpan.FromSeconds(10);
            return new TableServiceClient(settings.ConnectionString, options);
        }
        catch (Exception exception) when (exception is FormatException or ArgumentException or InvalidOperationException)
        {
            // The exception message may contain parts of the connection string: log only that it is malformed.
            LogNotConfigured(logger, "Storage__ConnectionString is malformed");
            return null;
        }
    }

    [LoggerMessage(Level = LogLevel.Warning, Message = "Storage is not configured: {Reason}.")]
    private static partial void LogNotConfigured(ILogger logger, string reason);
}
