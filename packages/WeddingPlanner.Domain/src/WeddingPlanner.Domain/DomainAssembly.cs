using System.Reflection;

namespace WeddingPlanner.Domain;

/// <summary>
/// Anchor for the pure domain assembly (RSVP rules, name normalisation and matching, CSV).
/// The domain references no Azure or ASP.NET Core packages; a test enforces this.
/// </summary>
public static class DomainAssembly
{
    /// <summary>The domain assembly.</summary>
    public static Assembly Assembly { get; } = typeof(DomainAssembly).Assembly;
}
