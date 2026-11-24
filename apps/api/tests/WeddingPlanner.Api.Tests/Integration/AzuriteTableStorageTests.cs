using Azure.Data.Tables;

using Shouldly;

using Xunit;

namespace WeddingPlanner.Api.Tests.Integration;

/// <summary>
/// Storage smoke test against Azurite (<c>pnpm storage:up</c>). Excluded from the Docker-free loop with
/// <c>dotnet test --filter "Category!=Integration"</c>.
/// </summary>
[Trait("Category", "Integration")]
public sealed class AzuriteTableStorageTests
{
    [Fact]
    public async Task CreatesAndDeletesATableWithARandomPrefix()
    {
        var cancellationToken = TestContext.Current.CancellationToken;
        var service = Azurite.CreateTableServiceClient();
        var tableName = $"{Azurite.NewTablePrefix()}Smoke";

        await Azurite.CallAsync(() => service.CreateTableAsync(tableName, cancellationToken));
        try
        {
            (await TableExistsAsync(service, tableName, cancellationToken)).ShouldBeTrue();

            var table = service.GetTableClient(tableName);
            await table.AddEntityAsync(new TableEntity("guests", "pablo") { ["Name"] = "Pablo Pérez" }, cancellationToken);
            var entity = await table.GetEntityAsync<TableEntity>("guests", "pablo", cancellationToken: cancellationToken);
            entity.Value.GetString("Name").ShouldBe("Pablo Pérez");
        }
        finally
        {
            await service.DeleteTableAsync(tableName, cancellationToken);
        }

        (await TableExistsAsync(service, tableName, cancellationToken)).ShouldBeFalse();
    }

    private static async Task<bool> TableExistsAsync(TableServiceClient service, string tableName, CancellationToken cancellationToken)
    {
        await foreach (var _ in service.QueryAsync(TableServiceClient.CreateQueryFilter($"TableName eq {tableName}"), cancellationToken: cancellationToken))
        {
            return true;
        }

        return false;
    }
}
