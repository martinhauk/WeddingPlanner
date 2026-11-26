using System.Reflection;
using System.Text.RegularExpressions;

using Microsoft.Azure.Functions.Worker;

using Shouldly;

using WeddingPlanner.Api.Features.Admin;
using WeddingPlanner.Api.Features.Admin.Export;
using WeddingPlanner.Api.Features.Admin.Rsvps;
using WeddingPlanner.Api.Features.FeatureFlags;

using Xunit;

namespace WeddingPlanner.Api.Tests.Admin;

/// <summary>
/// The admin routes, methods and function names. Every function on an admin route carries the <c>Admin</c> prefix, so
/// the feature gate (404 while <c>Features__Admin</c> is off) and the admin authorization middleware apply to it.
/// </summary>
public sealed partial class AdminFunctionCatalogTests
{
    [Theory]
    [InlineData(typeof(AdminRsvpsFunctions), nameof(AdminRsvpsFunctions.List), "AdminRsvpsList", "get", "rsvps")]
    [InlineData(typeof(AdminRsvpsFunctions), nameof(AdminRsvpsFunctions.Update), "AdminRsvpsUpdate", "put", "rsvps/{id}")]
    [InlineData(typeof(AdminRsvpsFunctions), nameof(AdminRsvpsFunctions.Delete), "AdminRsvpsDelete", "delete", "rsvps/{id}")]
    [InlineData(typeof(AdminExportFunction), nameof(AdminExportFunction.Run), "AdminExportCsv", "get", "export.csv")]
    public void DeclaresTheRoute(Type type, string methodName, string functionName, string httpMethod, string routeBelowAdmin)
    {
        var method = type.GetMethod(methodName).ShouldNotBeNull();
        var trigger = method.GetParameters().First().GetCustomAttribute<HttpTriggerAttribute>().ShouldNotBeNull();

        method.GetCustomAttribute<FunctionAttribute>().ShouldNotBeNull().Name.ShouldBe(functionName);
        trigger.AuthLevel.ShouldBe(AuthorizationLevel.Anonymous);
        trigger.Methods.ShouldBe([httpMethod]);
        trigger.Route.ShouldBe(AdminRoutes.Prefix + "/" + routeBelowAdmin);
        FeatureMap.ForFunction(functionName).ShouldBe(ApiFeature.Admin);
    }

    [Fact]
    public void NoRouteStartsWithTheReservedAdminSegment()
    {
        // The Functions host refuses to load a function whose route starts with "admin" (its management API).
        var routes = AllRoutes().Select(entry => entry.Route).ToList();

        routes.ShouldNotBeEmpty();
        routes.ShouldAllBe(route => !route.StartsWith("admin", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void EveryAdminRouteIsAnAdminFunction()
    {
        var admin = AllRoutes().Where(entry => entry.Route.StartsWith(AdminRoutes.Prefix, StringComparison.Ordinal)).ToList();

        admin.Count.ShouldBe(4);
        admin.ShouldAllBe(entry => FeatureMap.IsAdminFunction(entry.Name));
    }

    [Theory]
    [InlineData("admin", true)]
    [InlineData("adminx", false)]
    [InlineData("xadmin", false)]
    [InlineData("rsvp", false)]
    public void TheFirstSegmentMatchesOnlyAdmin(string segment, bool matches)
    {
        var constraint = ConstraintPattern().Match(AdminRoutes.Prefix);

        constraint.Success.ShouldBeTrue();
        Regex.IsMatch(segment, constraint.Groups["pattern"].Value, RegexOptions.IgnoreCase | RegexOptions.CultureInvariant).ShouldBe(matches);
    }

    private static List<(string Name, string Route)> AllRoutes() => typeof(AdminRsvpsFunctions).Assembly.GetTypes()
        .SelectMany(type => type.GetMethods())
        .Select(method => (Function: method.GetCustomAttribute<FunctionAttribute>(), Trigger: method.GetParameters().FirstOrDefault()?.GetCustomAttribute<HttpTriggerAttribute>()))
        .Where(entry => entry.Function is not null && entry.Trigger?.Route is not null)
        .Select(entry => (entry.Function?.Name ?? string.Empty, entry.Trigger?.Route ?? string.Empty))
        .ToList();

    [GeneratedRegex(@"^\{adminArea:regex\((?<pattern>.+)\)\}$")]
    private static partial Regex ConstraintPattern();
}
