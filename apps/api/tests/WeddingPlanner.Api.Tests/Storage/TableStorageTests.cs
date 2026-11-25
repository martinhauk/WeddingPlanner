using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

using Shouldly;

using WeddingPlanner.Api.Storage;
using WeddingPlanner.Api.Tests.Support;

using Xunit;

namespace WeddingPlanner.Api.Tests.Storage;

/// <summary>Configuration handling only: none of these tests reaches a network endpoint.</summary>
public sealed class TableStorageTests
{
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void IsNotConfiguredWithoutAConnectionString(string? connectionString)
    {
        var (storage, logs) = Create(new() { ["Storage:ConnectionString"] = connectionString });

        storage.IsConfigured.ShouldBeFalse();
        logs.Records.ShouldContain(record => record.Contains("Storage__ConnectionString is missing", StringComparison.Ordinal));
    }

    [Fact]
    public void IsNotConfiguredWithAMalformedConnectionStringAndNeverLogsIt()
    {
        var (storage, logs) = Create(new() { ["Storage:ConnectionString"] = "AccountName=sentinelaccount;AccountKey=sentinel-key;Garbage" });

        storage.IsConfigured.ShouldBeFalse();
        logs.Records.ShouldContain(record => record.Contains("malformed", StringComparison.Ordinal));
        logs.Records.ShouldNotContain(record => record.Contains("sentinel", StringComparison.OrdinalIgnoreCase));
    }

    [Theory]
    [InlineData("1abc")]
    [InlineData("ab-c")]
    [InlineData("ab_c")]
    public void IsNotConfiguredWithAnInvalidTablePrefix(string prefix)
    {
        var (storage, _) = Create(new() { ["Storage:ConnectionString"] = "UseDevelopmentStorage=true", ["Storage:TablePrefix"] = prefix });

        storage.IsConfigured.ShouldBeFalse();
    }

    [Theory]
    [InlineData(null)]
    [InlineData("t1a2b3c4")]
    public void IsConfiguredWithAConnectionStringWithoutNetworkIo(string? prefix)
    {
        var (storage, _) = Create(new() { ["Storage:ConnectionString"] = "UseDevelopmentStorage=true", ["Storage:TablePrefix"] = prefix });

        storage.IsConfigured.ShouldBeTrue();
    }

    [Fact]
    public async Task RefusesTableAccessWhenNotConfigured()
    {
        var (storage, _) = Create([]);

        await Should.ThrowAsync<InvalidOperationException>(() => storage.GetTableAsync("Rsvps", CancellationToken.None));
    }

    private static (TableStorage Storage, CapturingLoggerProvider Logs) Create(Dictionary<string, string?> settings)
    {
        var logs = new CapturingLoggerProvider();
        var services = new ServiceCollection();
        services.AddSingleton<IConfiguration>(new ConfigurationBuilder().AddInMemoryCollection(settings).Build());
        services.AddLogging(logging => logging.AddProvider(logs));
        services.AddStorage();
        var provider = services.BuildServiceProvider();
        return (provider.GetRequiredService<TableStorage>(), logs);
    }
}
