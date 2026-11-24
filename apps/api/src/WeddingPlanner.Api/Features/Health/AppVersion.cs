using System.Reflection;

namespace WeddingPlanner.Api.Features.Health;

/// <summary>
/// The API's build version: the assembly informational version, <c>&lt;Version&gt;+&lt;SourceRevisionId&gt;</c>
/// when built with <c>-p:SourceRevisionId=&lt;sha&gt;</c>. Read once from metadata; no I/O.
/// </summary>
public static class AppVersion
{
    /// <summary>The informational version of the API assembly, or <c>unknown</c>.</summary>
    public static string Current { get; } = typeof(AppVersion).Assembly
        .GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion ?? "unknown";
}
