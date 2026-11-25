namespace WeddingPlanner.Api.Storage;

/// <summary>
/// Storage settings, bound from the <c>Storage</c> section. Code defaults: no connection string (every
/// storage-backed feature answers 503 <c>not_configured</c>) and no table prefix.
/// </summary>
public sealed class StorageOptions
{
    /// <summary>Configuration section.</summary>
    public const string SectionName = "Storage";

    /// <summary>
    /// App setting <c>Storage__ConnectionString</c> (Bicep writes it; locally <c>UseDevelopmentStorage=true</c>).
    /// Not <c>AzureWebJobsStorage</c>: Static Web Apps reserves that prefix.
    /// </summary>
    public string? ConnectionString { get; set; }

    /// <summary>
    /// Optional prefix for every table name (<c>Storage__TablePrefix</c>), so tests and parallel local runs can
    /// share one Azurite. Letters and digits only, starting with a letter. Default: none.
    /// </summary>
    public string TablePrefix { get; set; } = string.Empty;
}
