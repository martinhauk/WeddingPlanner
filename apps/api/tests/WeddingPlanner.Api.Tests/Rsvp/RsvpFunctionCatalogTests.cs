using System.Reflection;

using Microsoft.Azure.Functions.Worker;

using Shouldly;

using WeddingPlanner.Api.Features.FeatureFlags;
using WeddingPlanner.Api.Features.Rsvp;
using WeddingPlanner.Api.Pipeline;

using Xunit;

namespace WeddingPlanner.Api.Tests.Rsvp;

/// <summary>
/// The RSVP routes, methods and function names. Every function on an <c>rsvp</c> route carries the <c>Rsvp</c> prefix,
/// so the feature gate answers 404 for all of <c>/api/rsvp*</c> while <c>Features__Rsvp</c> is off.
/// </summary>
public sealed class RsvpFunctionCatalogTests
{
    [Theory]
    [InlineData(typeof(RsvpCreateFunction), nameof(RsvpCreateFunction.Run), "RsvpCreate", "post", "rsvp")]
    [InlineData(typeof(RsvpMineFunctions), nameof(RsvpMineFunctions.Get), "RsvpGetMine", "get", "rsvp/me")]
    [InlineData(typeof(RsvpMineFunctions), nameof(RsvpMineFunctions.Update), "RsvpUpdateMine", "put", "rsvp/me")]
    [InlineData(typeof(RsvpMineFunctions), nameof(RsvpMineFunctions.Delete), "RsvpDeleteMine", "delete", "rsvp/me")]
    [InlineData(typeof(RsvpStatusFunction), nameof(RsvpStatusFunction.Run), "RsvpStatus", "get", "rsvp/status")]
    [InlineData(typeof(RsvpClaimFunction), nameof(RsvpClaimFunction.Run), "RsvpClaim", "post", "rsvp/claim")]
    public void DeclaresTheRoute(Type type, string methodName, string functionName, string httpMethod, string route)
    {
        var method = type.GetMethod(methodName).ShouldNotBeNull();
        var trigger = method.GetParameters().First().GetCustomAttribute<HttpTriggerAttribute>().ShouldNotBeNull();

        method.GetCustomAttribute<FunctionAttribute>().ShouldNotBeNull().Name.ShouldBe(functionName);
        trigger.AuthLevel.ShouldBe(AuthorizationLevel.Anonymous);
        trigger.Methods.ShouldBe([httpMethod]);
        trigger.Route.ShouldBe(route);
    }

    [Fact]
    public void EveryRsvpRouteIsGatedByTheRsvpFlag()
    {
        var functionNames = typeof(RsvpCreateFunction).Assembly.GetTypes()
            .SelectMany(type => type.GetMethods())
            .Select(method => (Function: method.GetCustomAttribute<FunctionAttribute>(), Trigger: method.GetParameters().FirstOrDefault()?.GetCustomAttribute<HttpTriggerAttribute>()))
            .Where(entry => entry.Trigger?.Route is { } route && route.StartsWith("rsvp", StringComparison.OrdinalIgnoreCase))
            .Select(entry => entry.Function?.Name ?? string.Empty)
            .ToList();

        functionNames.Count.ShouldBe(6);
        functionNames.ShouldAllBe(name => FeatureMap.ForFunction(name) == ApiFeature.Rsvp);
    }

    [Fact]
    public async Task TheGateAnswers404ForEveryRsvpFunctionWhileTheFlagIsOff()
    {
        var gate = new FeatureGateMiddleware(Microsoft.Extensions.Options.Options.Create(new FeaturesOptions()));
        foreach (var name in new[] { "RsvpCreate", "RsvpGetMine", "RsvpUpdateMine", "RsvpDeleteMine", "RsvpStatus", "RsvpClaim" })
        {
            var httpContext = Support.TestFunctionContext.CreateHttpContext();
            var ran = false;

            await gate.Invoke(new Support.TestFunctionContext(name, httpContext: httpContext), _ =>
            {
                ran = true;
                return Task.CompletedTask;
            });

            ran.ShouldBeFalse(name);
            httpContext.Response.StatusCode.ShouldBe(404, name);
        }
    }
}
