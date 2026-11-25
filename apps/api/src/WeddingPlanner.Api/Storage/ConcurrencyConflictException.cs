namespace WeddingPlanner.Api.Storage;

/// <summary>An entity changed since it was read: the <c>If-Match</c> ETag no longer matches (HTTP 412).</summary>
public sealed class ConcurrencyConflictException : Exception
{
    public ConcurrencyConflictException()
        : base("The entity was changed by another request.")
    {
    }

    public ConcurrencyConflictException(string message)
        : base(message)
    {
    }

    public ConcurrencyConflictException(string message, Exception innerException)
        : base(message, innerException)
    {
    }
}
