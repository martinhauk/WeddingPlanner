using System.Globalization;

using WeddingPlanner.Api.Storage;
using WeddingPlanner.Api.Storage.Rsvps;

namespace WeddingPlanner.Api.Tests.Support;

/// <summary>
/// In-memory <see cref="IRsvpRepository"/> with the same ETag semantics as Table Storage: every write produces a
/// new ETag, and a replace or delete with a stale ETag throws <see cref="ConcurrencyConflictException"/>.
/// </summary>
internal sealed class InMemoryRsvpRepository : IRsvpRepository
{
    private readonly Dictionary<string, StoredRsvp> _items = new(StringComparer.Ordinal);
    private int _version;

    public bool IsConfigured { get; set; } = true;

    /// <summary>Number of storage calls of any kind (to prove that a request did no I/O).</summary>
    public int Calls { get; private set; }

    /// <summary>Number of <see cref="CountAsync"/> calls.</summary>
    public int CountCalls { get; private set; }

    /// <summary>When set, <see cref="CountAsync"/> throws the exception it returns (a storage failure).</summary>
    public Func<Exception>? CountFailure { get; set; }

    /// <summary>Runs before a replace or delete is applied, for example to simulate a concurrent change.</summary>
    public Action<string>? BeforeWrite { get; set; }

    public IReadOnlyCollection<StoredRsvp> Items => _items.Values;

    public Task<StoredRsvp?> GetAsync(string id, CancellationToken cancellationToken)
    {
        Calls++;
        return Task.FromResult(_items.GetValueOrDefault(id));
    }

    public Task<StoredRsvp> AddAsync(RsvpRecord record, CancellationToken cancellationToken)
    {
        Calls++;
        if (_items.ContainsKey(record.Id))
        {
            throw new InvalidOperationException("The reply already exists.");
        }

        var stored = new StoredRsvp(record, NextETag());
        _items[record.Id] = stored;
        return Task.FromResult(stored);
    }

    public Task<StoredRsvp?> ReplaceAsync(RsvpRecord record, string ifMatch, CancellationToken cancellationToken)
    {
        Calls++;
        BeforeWrite?.Invoke(record.Id);
        if (!_items.TryGetValue(record.Id, out var current))
        {
            return Task.FromResult<StoredRsvp?>(null);
        }

        if (ifMatch != "*" && ifMatch != current.ETag)
        {
            throw new ConcurrencyConflictException();
        }

        var stored = new StoredRsvp(record, NextETag());
        _items[record.Id] = stored;
        return Task.FromResult<StoredRsvp?>(stored);
    }

    public Task<bool> DeleteAsync(string id, string ifMatch, CancellationToken cancellationToken)
    {
        Calls++;
        BeforeWrite?.Invoke(id);
        if (!_items.TryGetValue(id, out var current))
        {
            return Task.FromResult(false);
        }

        if (ifMatch != "*" && ifMatch != current.ETag)
        {
            throw new ConcurrencyConflictException();
        }

        _items.Remove(id);
        return Task.FromResult(true);
    }

    public Task<IReadOnlyList<StoredRsvp>> ListAsync(CancellationToken cancellationToken)
    {
        Calls++;
        return Task.FromResult<IReadOnlyList<StoredRsvp>>([.. _items.Values]);
    }

    public Task<int> CountAsync(CancellationToken cancellationToken)
    {
        Calls++;
        CountCalls++;
        return CountFailure is { } failure ? Task.FromException<int>(failure()) : Task.FromResult(_items.Count);
    }

    /// <summary>Changes the ETag of a stored reply, as a concurrent write would.</summary>
    public void Touch(string id) => _items[id] = _items[id] with { ETag = NextETag() };

    private string NextETag() => $"W/\"v{(++_version).ToString(CultureInfo.InvariantCulture)}\"";
}
