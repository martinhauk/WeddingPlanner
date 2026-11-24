using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

using Shouldly;

using WeddingPlanner.Api.Features.FeatureFlags;

using Xunit;

namespace WeddingPlanner.Api.Tests.FeatureFlags;

public sealed class FeaturesOptionsTests
{
    [Fact]
    public void EveryFlagIsOffByDefault()
    {
        var options = Bind(new Dictionary<string, string?>());

        options.Rsvp.ShouldBeFalse();
        options.Admin.ShouldBeFalse();
        Enum.GetValues<ApiFeature>().ShouldAllBe(feature => !options.IsEnabled(feature));
    }

    [Theory]
    [InlineData("true", "false", true, false)]
    [InlineData("false", "true", false, true)]
    [InlineData("True", "TRUE", true, true)]
    [InlineData(" true ", "false", true, false)]
    public void BindsTheFlagsFromTheFeaturesSection(string rsvp, string admin, bool expectedRsvp, bool expectedAdmin)
    {
        var options = Bind(new Dictionary<string, string?> { ["Features:Rsvp"] = rsvp, ["Features:Admin"] = admin });

        options.Rsvp.ShouldBe(expectedRsvp);
        options.Admin.ShouldBe(expectedAdmin);
        options.IsEnabled(ApiFeature.Rsvp).ShouldBe(expectedRsvp);
        options.IsEnabled(ApiFeature.Admin).ShouldBe(expectedAdmin);
    }

    [Theory]
    [InlineData("")]
    [InlineData("yes")]
    [InlineData("1")]
    [InlineData("on")]
    public void MalformedValuesKeepTheFeatureOff(string value)
    {
        var options = Bind(new Dictionary<string, string?> { ["Features:Rsvp"] = value, ["Features:Admin"] = value });

        options.Rsvp.ShouldBeFalse();
        options.Admin.ShouldBeFalse();
    }

    [Fact]
    public void BindsTheFeaturesDoubleUnderscoreAppSettings()
    {
        // App settings arrive as environment variables: Features__Rsvp, Features__Admin.
        var prefix = $"WPTEST_{Guid.NewGuid():N}_";
        Environment.SetEnvironmentVariable($"{prefix}Features__Rsvp", "true");
        Environment.SetEnvironmentVariable($"{prefix}Features__Admin", "false");
        try
        {
            var configuration = new ConfigurationBuilder().AddEnvironmentVariables(prefix).Build();

            var options = Bind(configuration);

            options.Rsvp.ShouldBeTrue();
            options.Admin.ShouldBeFalse();
        }
        finally
        {
            Environment.SetEnvironmentVariable($"{prefix}Features__Rsvp", null);
            Environment.SetEnvironmentVariable($"{prefix}Features__Admin", null);
        }
    }

    private static FeaturesOptions Bind(Dictionary<string, string?> values) =>
        Bind(new ConfigurationBuilder().AddInMemoryCollection(values).Build());

    private static FeaturesOptions Bind(IConfiguration configuration)
    {
        var services = new ServiceCollection();
        services.AddSingleton(configuration);
        services.AddFeatureFlags();
        using var provider = services.BuildServiceProvider();
        return provider.GetRequiredService<IOptions<FeaturesOptions>>().Value;
    }
}
