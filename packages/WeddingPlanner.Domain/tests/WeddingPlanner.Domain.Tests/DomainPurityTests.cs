using System.Text.Json;
using System.Xml.Linq;

using Shouldly;

using Xunit;

namespace WeddingPlanner.Domain.Tests;

/// <summary>
/// The domain is pure: no Azure SDK and no ASP.NET Core, so business rules stay testable without
/// infrastructure and can never reach storage or HTTP by accident.
/// </summary>
public sealed class DomainPurityTests
{
    private static readonly string[] _forbiddenPrefixes = ["Azure.", "Microsoft.AspNetCore", "Microsoft.Azure."];

    private static readonly string _domainProjectDirectory = Path.Combine(
        FindRepositoryRoot(), "packages", "WeddingPlanner.Domain", "src", "WeddingPlanner.Domain");

    [Fact]
    public void DomainAssemblyReferencesNoAzureOrAspNetCoreAssembly()
    {
        var references = DomainAssembly.Assembly.GetReferencedAssemblies().Select(name => name.Name ?? string.Empty);

        references.Where(IsForbidden).ShouldBeEmpty();
    }

    [Fact]
    public void DomainProjectDeclaresNoAzureOrAspNetCoreReference()
    {
        var project = XDocument.Load(Path.Combine(_domainProjectDirectory, "WeddingPlanner.Domain.csproj"));
        var declared = project.Descendants()
            .Where(element => element.Name.LocalName is "PackageReference" or "FrameworkReference" or "ProjectReference")
            .Select(element => (string?)element.Attribute("Include") ?? string.Empty)
            .ToList();

        declared.Where(IsForbidden).ShouldBeEmpty();
        declared.Where(include => include.EndsWith(".csproj", StringComparison.OrdinalIgnoreCase)).ShouldBeEmpty(
            "the domain must not depend on other projects");
    }

    [Fact]
    public void DomainRestoreGraphContainsNoAzureOrAspNetCorePackage()
    {
        // project.assets.json lists every transitive package and framework reference of the domain.
        // It assumes the default obj/ next to the project: update this path if the build ever moves
        // intermediate output (--artifacts-path, UseArtifactsOutput or a custom BaseIntermediateOutputPath).
        var assetsPath = Path.Combine(_domainProjectDirectory, "obj", "project.assets.json");
        File.Exists(assetsPath).ShouldBeTrue($"restore output missing: {assetsPath}");

        using var assets = JsonDocument.Parse(File.ReadAllText(assetsPath));
        var libraries = assets.RootElement.GetProperty("libraries").EnumerateObject()
            .Select(library => library.Name.Split('/')[0]);
        var frameworkReferences = assets.RootElement.GetProperty("project").GetProperty("frameworks").EnumerateObject()
            .SelectMany(framework => framework.Value.TryGetProperty("frameworkReferences", out var references)
                ? references.EnumerateObject().Select(reference => reference.Name)
                : []);

        libraries.Concat(frameworkReferences).Where(IsForbidden).ShouldBeEmpty();
    }

    private static bool IsForbidden(string name) =>
        _forbiddenPrefixes.Any(prefix => name.StartsWith(prefix, StringComparison.OrdinalIgnoreCase));

    private static string FindRepositoryRoot()
    {
        for (var directory = new DirectoryInfo(AppContext.BaseDirectory); directory is not null; directory = directory.Parent)
        {
            if (File.Exists(Path.Combine(directory.FullName, "WeddingPlanner.slnx")))
            {
                return directory.FullName;
            }
        }

        throw new InvalidOperationException("WeddingPlanner.slnx not found above the test output directory.");
    }
}
