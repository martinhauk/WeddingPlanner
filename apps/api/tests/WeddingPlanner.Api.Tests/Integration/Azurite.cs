using System.Net.Sockets;

using Azure;
using Azure.Data.Tables;

namespace WeddingPlanner.Api.Tests.Integration;

/// <summary>
/// Conventions for storage integration tests (trait <c>Category=Integration</c>) against Azurite, which
/// <c>pnpm storage:up</c> starts via docker compose (a service container in CI):
/// <list type="bullet">
///   <item>the connection string comes from <c>AZURITE_CONNECTION_STRING</c> (default <c>UseDevelopmentStorage=true</c>);</item>
///   <item>only loopback endpoints are accepted, so a test can never touch a real storage account;</item>
///   <item>every run uses a random table prefix, so parallel worktrees can share one Azurite;</item>
///   <item>an unreachable Azurite fails fast with a hint to run <c>pnpm storage:up</c>.</item>
/// </list>
/// </summary>
internal static class Azurite
{
    /// <summary>Environment variable with the Azurite connection string.</summary>
    public const string ConnectionStringVariable = "AZURITE_CONNECTION_STRING";

    /// <summary>Connection string used when <see cref="ConnectionStringVariable"/> is not set.</summary>
    public const string DefaultConnectionString = "UseDevelopmentStorage=true";

    /// <summary>Failure message when Azurite does not answer.</summary>
    public const string UnreachableMessage =
        "Azurite is not reachable. Start it with `pnpm storage:up` (docker compose) and run the tests again.";

    /// <summary>The connection string for this run.</summary>
    public static string ConnectionString => ResolveConnectionString(Environment.GetEnvironmentVariable(ConnectionStringVariable));

    /// <summary>Falls back to <see cref="DefaultConnectionString"/> for a missing or blank value.</summary>
    public static string ResolveConnectionString(string? value) =>
        string.IsNullOrWhiteSpace(value) ? DefaultConnectionString : value;

    /// <summary>
    /// Creates a client for the Azurite table endpoint. Throws when the endpoint is not local. No retries and a short
    /// network timeout, so an unreachable emulator fails within seconds.
    /// </summary>
    public static TableServiceClient CreateTableServiceClient(string? connectionString = null)
    {
        var options = new TableClientOptions();
        options.Retry.MaxRetries = 0;
        options.Retry.NetworkTimeout = TimeSpan.FromSeconds(5);

        var client = new TableServiceClient(connectionString ?? ConnectionString, options);
        if (!client.Uri.IsLoopback)
        {
            // Never echo the endpoint: it could be a real account's hostname.
            throw new InvalidOperationException(
                $"Refusing to run storage integration tests against a non-local endpoint. {ConnectionStringVariable} must point at Azurite on localhost.");
        }

        return client;
    }

    /// <summary>A random, valid table-name prefix for one test run: a letter followed by 8 lowercase hex characters.</summary>
    public static string NewTablePrefix() => $"t{Guid.NewGuid():N}"[..9];

    /// <summary>Runs a storage call and turns connection failures into a <c>pnpm storage:up</c> hint.</summary>
    public static async Task<T> CallAsync<T>(Func<Task<T>> call)
    {
        ArgumentNullException.ThrowIfNull(call);

        try
        {
            return await call();
        }
        catch (Exception exception) when (IsUnreachable(exception))
        {
            throw new InvalidOperationException(UnreachableMessage, exception);
        }
    }

    private static bool IsUnreachable(Exception exception)
    {
        for (Exception? current = exception; current is not null; current = current.InnerException)
        {
            if (current is HttpRequestException or SocketException or TimeoutException or RequestFailedException { Status: 0 })
            {
                return true;
            }

            if (current is AggregateException aggregate && aggregate.InnerExceptions.Any(IsUnreachable))
            {
                return true;
            }
        }

        return false;
    }
}
