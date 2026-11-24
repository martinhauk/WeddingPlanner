using System.Net;
using System.Net.Sockets;

using Azure.Data.Tables;

using Shouldly;

using Xunit;

namespace WeddingPlanner.Api.Tests.Integration;

/// <summary>Unit tests for the Azurite conventions; they need no running emulator.</summary>
public sealed class AzuriteTests
{
    // A syntactically valid but meaningless account key (64 zero bytes), so no real key appears in the repo.
    private static readonly string _dummyKey = Convert.ToBase64String(new byte[64]);

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("  ")]
    public void DefaultsToDevelopmentStorage(string? value)
    {
        Azurite.ResolveConnectionString(value).ShouldBe("UseDevelopmentStorage=true");
    }

    [Fact]
    public void UsesTheConfiguredConnectionString()
    {
        var configured = $"DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey={_dummyKey};TableEndpoint=http://127.0.0.1:10002/devstoreaccount1;";

        Azurite.ResolveConnectionString(configured).ShouldBe(configured);
    }

    [Theory]
    [InlineData("UseDevelopmentStorage=true")]
    [InlineData("DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey={key};TableEndpoint=http://127.0.0.1:10002/devstoreaccount1;")]
    [InlineData("DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey={key};TableEndpoint=http://localhost:10002/devstoreaccount1;")]
    public void AcceptsLocalEndpoints(string connectionString)
    {
        var client = Azurite.CreateTableServiceClient(connectionString.Replace("{key}", _dummyKey, StringComparison.Ordinal));

        client.Uri.IsLoopback.ShouldBeTrue();
    }

    [Theory]
    [InlineData("DefaultEndpointsProtocol=https;AccountName=example;AccountKey={key};EndpointSuffix=core.windows.net")]
    [InlineData("DefaultEndpointsProtocol=https;AccountName=example;AccountKey={key};TableEndpoint=https://example.com/")]
    public void RefusesNonLocalEndpoints(string connectionString)
    {
        var exception = Should.Throw<InvalidOperationException>(
            () => Azurite.CreateTableServiceClient(connectionString.Replace("{key}", _dummyKey, StringComparison.Ordinal)));

        exception.Message.ShouldContain("non-local endpoint");
        exception.Message.ShouldNotContain("example");
    }

    [Fact]
    public async Task FailsFastWithAStorageUpHintWhenAzuriteIsUnreachable()
    {
        var client = Azurite.CreateTableServiceClient(
            $"DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey={_dummyKey};TableEndpoint=http://127.0.0.1:{FindClosedPort()}/devstoreaccount1;");
        var cancellationToken = TestContext.Current.CancellationToken;

        var exception = await Should.ThrowAsync<InvalidOperationException>(
            () => Azurite.CallAsync(() => client.CreateTableIfNotExistsAsync($"{Azurite.NewTablePrefix()}Unreachable", cancellationToken)));

        exception.Message.ShouldContain("pnpm storage:up");
    }

    [Fact]
    public void TablePrefixesAreRandomAndValidTableNameStarts()
    {
        var prefixes = Enumerable.Range(0, 20).Select(_ => Azurite.NewTablePrefix()).ToList();

        // Azure table names: alphanumeric, starting with a letter; the prefix leaves room for a suffix.
        prefixes.ShouldAllBe(prefix => prefix.Length == 9 && prefix[0] == 't');
        prefixes.ShouldAllBe(prefix => prefix.All(c => char.IsAsciiDigit(c) || char.IsAsciiLetterLower(c)));
        prefixes.Distinct().Count().ShouldBe(prefixes.Count);
    }

    private static int FindClosedPort()
    {
        using var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;
        listener.Stop();
        return port;
    }
}
