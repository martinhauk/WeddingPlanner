using System.Collections.Concurrent;

using Microsoft.Extensions.Logging;

namespace WeddingPlanner.Api.Tests.Support;

/// <summary>
/// Records the level, message, structured state, scopes and exception (including its message) of every log call
/// as text, so privacy tests can assert that no personal data, token or address reaches any log.
/// </summary>
internal sealed class CapturingLoggerProvider : ILoggerProvider
{
    private readonly ConcurrentQueue<string> _records = new();

    public IReadOnlyCollection<string> Records => _records;

    public ILogger CreateLogger(string categoryName) => new CapturingLogger(categoryName, _records);

    public void Dispose()
    {
    }

    private sealed class CapturingLogger(string category, ConcurrentQueue<string> records) : ILogger
    {
        public IDisposable BeginScope<TState>(TState state)
            where TState : notnull
        {
            records.Enqueue($"scope: {Describe(state)}");
            return NullScope.Instance;
        }

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
        {
            ArgumentNullException.ThrowIfNull(formatter);
            records.Enqueue($"{logLevel} {category} {eventId}: {formatter(state, exception)} | {Describe(state)} | {exception}");
        }

        private static string Describe<TState>(TState state) => state is IEnumerable<KeyValuePair<string, object?>> properties
            ? string.Join("; ", properties.Select(property => $"{property.Key}={property.Value}"))
            : state?.ToString() ?? string.Empty;
    }

    private sealed class NullScope : IDisposable
    {
        public static readonly NullScope Instance = new();

        public void Dispose()
        {
        }
    }
}
