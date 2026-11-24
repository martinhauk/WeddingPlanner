using Shouldly;

using WeddingPlanner.Api.Features.FeatureFlags;

using Xunit;

namespace WeddingPlanner.Api.Tests.FeatureFlags;

public sealed class FeatureMapTests
{
    [Theory]
    [InlineData("RsvpStatus", ApiFeature.Rsvp)]
    [InlineData("RsvpCreate", ApiFeature.Rsvp)]
    [InlineData("RsvpMeGet", ApiFeature.Rsvp)]
    [InlineData("rsvpClaim", ApiFeature.Rsvp)]
    [InlineData("AdminRsvpsList", ApiFeature.Admin)]
    [InlineData("AdminGuestsImport", ApiFeature.Admin)]
    [InlineData("ADMINExport", ApiFeature.Admin)]
    public void MapsFunctionsToFeaturesByNamePrefix(string functionName, ApiFeature expected)
    {
        FeatureMap.ForFunction(functionName).ShouldBe(expected);
    }

    [Theory]
    [InlineData("Health")]
    [InlineData("HealthProbe")]
    [InlineData("Version")]
    public void LeavesOtherFunctionsUngated(string functionName)
    {
        FeatureMap.ForFunction(functionName).ShouldBeNull();
    }

    [Theory]
    [InlineData("AdminRsvpsList", true)]
    [InlineData("AdminPing", true)]
    [InlineData("RsvpCreate", false)]
    [InlineData("Health", false)]
    public void RecognisesAdminFunctions(string functionName, bool expected)
    {
        FeatureMap.IsAdminFunction(functionName).ShouldBe(expected);
    }
}
