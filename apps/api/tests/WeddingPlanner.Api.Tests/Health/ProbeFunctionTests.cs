using System.Collections.Concurrent;
using System.Net;
using System.Reflection;
using System.Text.Json;

using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Abstractions;
using Microsoft.AspNetCore.Routing;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

using Shouldly;

using WeddingPlanner.Api.Features.FeatureFlags;
using WeddingPlanner.Api.Features.Health;

using Xunit;

namespace WeddingPlanner.Api.Tests.Health;

public sealed class ProbeFunctionTests
{
    private const string ProbeSetCookie = "wp_probe=1; Max-Age=60; Path=/api/health; Secure; HttpOnly; SameSite=Strict";

    // Documentation addresses (RFC 5737, RFC 3849) and example.com only.
    private const string ClientAddress = "203.0.113.7";
    private const string EdgeAddress = "198.51.100.10";
    private const string ForwardedHost = "probe-sentinel.example.com";
    private const string ClientPrincipal = "eyJ1c2VySWQiOiJzZW50aW5lbCJ9";

    [Fact]
    public void IsAnonymousGetOnApiHealthProbe()
    {
        var method = typeof(ProbeFunction).GetMethod(nameof(ProbeFunction.Run)).ShouldNotBeNull();
        var trigger = method.GetParameters().Single().GetCustomAttribute<HttpTriggerAttribute>().ShouldNotBeNull();

        method.GetCustomAttribute<FunctionAttribute>().ShouldNotBeNull().Name.ShouldBe("HealthProbe");
        trigger.AuthLevel.ShouldBe(AuthorizationLevel.Anonymous);
        trigger.Methods.ShouldBe(["get"]);
        trigger.Route.ShouldBe("health/probe");
    }

    [Fact]
    public void IsNeverFeatureGated()
    {
        FeatureMap.ForFunction(ProbeFunction.FunctionName).ShouldBeNull();
    }

    [Fact]
    public void DependsOnNothingButConfiguration()
    {
        // No storage client, repository, logger or HTTP client: the probe performs no I/O and stores nothing.
        var constructor = typeof(ProbeFunction).GetConstructors().ShouldHaveSingleItem();

        constructor.GetParameters().Select(parameter => parameter.ParameterType).ShouldBe([typeof(IConfiguration)]);
    }

    [Fact]
    public async Task IsOffByCodeDefault()
    {
        // Every app setting has a code default, and a missing one may only disable a feature (CLAUDE.md).
        ProbeFunction.EnabledByDefault.ShouldBeFalse();
        var httpContext = CreateHttpContext();

        await RunAsync(Probe(settingValue: null), httpContext);

        httpContext.Response.StatusCode.ShouldBe(StatusCodes.Status404NotFound);
        httpContext.Response.Headers.CacheControl.ToString().ShouldBe("no-store");
        httpContext.Response.Headers.ContainsKey("Set-Cookie").ShouldBeFalse();
    }

    [Fact]
    public async Task SwitchedOnItSetsTheProbeCookie()
    {
        var httpContext = CreateHttpContext();

        await RunAsync(Probe(), httpContext);

        httpContext.Response.StatusCode.ShouldBe(StatusCodes.Status200OK);
        httpContext.Response.ContentType.ShouldNotBeNull().ShouldStartWith("application/json");
        httpContext.Response.Headers.CacheControl.ToString().ShouldBe("no-store");
        httpContext.Response.Headers.SetCookie.ToArray().ShouldBe([ProbeSetCookie]);
    }

    [Theory]
    [InlineData("true")]
    [InlineData("True")]
    [InlineData(" TRUE ")]
    public void OnlyATrueSettingSwitchesTheProbeOn(string value)
    {
        var httpContext = CreateHttpContext();

        var result = Probe(value).Run(httpContext.Request);

        result.ShouldBeOfType<OkObjectResult>();
        httpContext.Response.Headers.SetCookie.ToArray().ShouldBe([ProbeSetCookie]);
    }

    [Theory]
    [InlineData("")]
    [InlineData(" ")]
    [InlineData("false")]
    [InlineData("False")]
    [InlineData("0")]
    [InlineData("off")]
    [InlineData("not-a-boolean")]
    public async Task EmptyFalseOrMalformedSettingAnswers404WithoutACookie(string value)
    {
        var httpContext = CreateHttpContext();
        httpContext.Request.Headers["X-Forwarded-For"] = ClientAddress;

        await RunAsync(Probe(value), httpContext);

        httpContext.Response.StatusCode.ShouldBe(StatusCodes.Status404NotFound);
        httpContext.Response.ContentType.ShouldNotBeNull().ShouldStartWith("application/problem+json");
        httpContext.Response.Headers.CacheControl.ToString().ShouldBe("no-store");
        httpContext.Response.Headers.ContainsKey("Set-Cookie").ShouldBeFalse();
        using var problem = JsonDocument.Parse(ReadBody(httpContext));
        problem.RootElement.GetProperty("status").GetInt32().ShouldBe(404);
        problem.RootElement.GetProperty("title").GetString().ShouldBe("Not Found");
        problem.RootElement.GetProperty("code").GetString().ShouldBe("not_found");
        ReadBody(httpContext).ShouldNotContain(ClientAddress);
    }

    [Theory]
    [InlineData("true", StatusCodes.Status200OK)]
    [InlineData("false", StatusCodes.Status404NotFound)]
    public void TheAppSettingHealthProbeEnabledSwitchesIt(string value, int expectedStatus)
    {
        // App settings arrive as environment variables; "__" maps to the configuration key separator.
        var prefix = $"WPTEST_{Guid.NewGuid():N}_";
        var variable = prefix + "HealthProbe__Enabled";
        Environment.SetEnvironmentVariable(variable, value);
        try
        {
            var configuration = new ConfigurationBuilder().AddEnvironmentVariables(prefix).Build();
            var httpContext = CreateHttpContext();

            new ProbeFunction(configuration).Run(httpContext.Request)
                .ShouldBeAssignableTo<ObjectResult>().ShouldNotBeNull().StatusCode.ShouldBe(expectedStatus);
        }
        finally
        {
            Environment.SetEnvironmentVariable(variable, null);
        }
    }

    [Fact]
    public void TheAppSettingAvoidsThePrefixesStaticWebAppsReserves()
    {
        // Static Web Apps rejects app settings with these prefixes (case-insensitive), so a Diagnostics__ name
        // could never be set; infra/app/tests checks the same list for every Bicep app setting.
        string[] reserved =
        [
            "APPSETTING_", "AZUREBLOBSTORAGE_", "AZUREFILESSTORAGE_", "AZURE_FUNCTION_", "CONTAINER_", "DIAGNOSTICS_",
            "DOCKER_", "FUNCTIONS_", "IDENTITY_", "MACHINEKEY_", "MAINSITE_", "MSDEPLOY_", "SCMSITE_", "SCM_",
            "WEBSITES_", "WEBSITE_", "WEBSOCKET_", "AZUREWEB",
        ];
        var appSetting = ProbeFunction.EnabledSettingKey.Replace(":", "__", StringComparison.Ordinal);

        appSetting.ShouldBe("HealthProbe__Enabled");
        reserved.ShouldAllBe(prefix => !appSetting.StartsWith(prefix, StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task ReturnsTheForwardingHeadersHopCountCookieAndPrincipalAsCamelCaseJson()
    {
        var httpContext = CreateHttpContext();
        httpContext.Request.Headers["X-Forwarded-For"] = $"{ClientAddress}:51234, {EdgeAddress}";
        httpContext.Request.Headers["X-Azure-ClientIP"] = ClientAddress;
        httpContext.Request.Headers["X-Client-IP"] = ClientAddress;
        httpContext.Request.Headers["X-Forwarded-Host"] = ForwardedHost;
        httpContext.Request.Headers["Accept"] = "application/json";

        await RunAsync(Probe(), httpContext);

        using var body = JsonDocument.Parse(ReadBody(httpContext));
        var root = body.RootElement;
        root.EnumerateObject().Select(property => property.Name).ShouldBe(
        [
            "forwardingHeaders",
            "remoteAddress",
            "xffHopCount",
            "addressMatches",
            "requestHeaderNames",
            "cookieReceived",
            "hasClientPrincipal",
        ]);
        root.GetProperty("forwardingHeaders").EnumerateObject()
            .Select(header => (header.Name, header.Value.GetString()))
            .ShouldBe(
            [
                ("x-forwarded-for", $"{ClientAddress}:51234, {EdgeAddress}"),
                ("x-forwarded-host", ForwardedHost),
                ("x-azure-clientip", ClientAddress),
                ("x-client-ip", ClientAddress),
            ]);
        root.GetProperty("remoteAddress").ValueKind.ShouldBe(JsonValueKind.Null);
        root.GetProperty("xffHopCount").GetInt32().ShouldBe(2);
        root.GetProperty("addressMatches").EnumerateObject()
            .Select(source => (source.Name, string.Join(' ', source.Value.EnumerateArray().Select(location => location.GetString()))))
            .ShouldBe([("x-azure-clientip", "x-forwarded-for[0] x-client-ip"), ("x-client-ip", "x-forwarded-for[0] x-azure-clientip")]);
        root.GetProperty("requestHeaderNames").EnumerateArray().Select(name => name.GetString())
            .ShouldBe(["accept", "x-azure-clientip", "x-client-ip", "x-forwarded-for", "x-forwarded-host"]);
        root.GetProperty("cookieReceived").GetBoolean().ShouldBeFalse();
        root.GetProperty("hasClientPrincipal").GetBoolean().ShouldBeFalse();
    }

    [Fact]
    public void CookieReceivedIsFalseWithoutTheCookie()
    {
        Measure(new HeaderDictionary()).CookieReceived.ShouldBeFalse();
    }

    [Fact]
    public void CookieReceivedIsTrueWithTheCookie()
    {
        Measure(new HeaderDictionary { ["Cookie"] = "other=x; wp_probe=1" }).CookieReceived.ShouldBeTrue();
    }

    [Fact]
    public void CookieReceivedIsFalseWhenTheCookieValueChanged()
    {
        Measure(new HeaderDictionary { ["Cookie"] = "wp_probe=2" }).CookieReceived.ShouldBeFalse();
    }

    [Fact]
    public async Task TheSecondCallOfTheRoundTripSeesTheCookieOfTheFirst()
    {
        var first = CreateHttpContext();
        await RunAsync(Probe(), first);
        var nameAndValue = first.Response.Headers.SetCookie.ToString().Split(';')[0];
        var second = CreateHttpContext();
        second.Request.Headers.Cookie = nameAndValue;

        await RunAsync(Probe(), second);

        ReadJson(first).GetProperty("cookieReceived").GetBoolean().ShouldBeFalse();
        ReadJson(second).GetProperty("cookieReceived").GetBoolean().ShouldBeTrue();
        second.Response.Headers.SetCookie.ToArray().ShouldBe([ProbeSetCookie]);
    }

    [Theory]
    [InlineData(null, false)]
    [InlineData("", false)]
    [InlineData(ClientPrincipal, true)]
    public void HasClientPrincipalReflectsTheSwaPrincipalHeader(string? principal, bool expected)
    {
        var headers = new HeaderDictionary();
        if (principal is not null)
        {
            headers["x-ms-client-principal"] = principal;
        }

        Measure(headers).HasClientPrincipal.ShouldBe(expected);
    }

    [Fact]
    public void WithoutForwardingHeadersTheEchoIsEmpty()
    {
        var response = Measure(new HeaderDictionary { ["Accept"] = "*/*" });

        response.ForwardingHeaders.ShouldBeEmpty();
        response.RemoteAddress.ShouldBeNull();
        response.XffHopCount.ShouldBe(0);
        response.AddressMatches.ShouldBeEmpty();
        response.RequestHeaderNames.ShouldBe(["accept"]);
    }

    [Fact]
    public void CountsXffEntriesAcrossRepeatedHeadersAndSkipsEmptyEntries()
    {
        var headers = new HeaderDictionary { ["X-Forwarded-For"] = new([$"{ClientAddress}, ", $" , {EdgeAddress}, 192.0.2.1"]) };

        var response = Measure(headers);

        response.XffHopCount.ShouldBe(3);
        response.ForwardingHeaders["x-forwarded-for"].ShouldBe($"{ClientAddress}, ,  , {EdgeAddress}, 192.0.2.1");
    }

    [Fact]
    public void LocatesEachSingleAddressHeaderInXffIgnoringPorts()
    {
        var headers = new HeaderDictionary
        {
            ["X-Forwarded-For"] = $"192.0.2.1, [2001:db8::7]:443, {EdgeAddress}:8080, {ClientAddress}",
            ["X-Azure-ClientIP"] = "2001:db8::7",
            ["X-Azure-SocketIP"] = $"{EdgeAddress}",
            ["X-Client-IP"] = $"{ClientAddress}:51234",
            ["X-Real-IP"] = "::ffff:192.0.2.1",
            ["True-Client-IP"] = "198.51.100.99",
            ["Client-IP"] = "unknown",
        };

        var response = Measure(headers);

        response.XffHopCount.ShouldBe(4);
        response.AddressMatches["x-azure-clientip"].ShouldBe(["x-forwarded-for[1]"]);
        response.AddressMatches["x-azure-socketip"].ShouldBe(["x-forwarded-for[2]"]);
        response.AddressMatches["x-client-ip"].ShouldBe(["x-forwarded-for[3]"]);
        response.AddressMatches["x-real-ip"].ShouldBe(["x-forwarded-for[0]"]);
        response.AddressMatches["true-client-ip"].ShouldBeEmpty();
        response.AddressMatches["client-ip"].ShouldBeEmpty();
    }

    [Fact]
    public void LocatesTheConnectionAddressAndTheOriginalForHeader()
    {
        // When the worker's forwarded-headers handling consumed the last X-Forwarded-For entry, that entry is
        // the connection address and the previous connection address is in X-Original-For.
        var headers = new HeaderDictionary
        {
            ["X-Original-For"] = $"[::ffff:{ClientAddress}]:51234, {EdgeAddress}",
            ["X-Azure-ClientIP"] = ClientAddress,
        };

        var response = Measure(headers, IPAddress.Parse($"::ffff:{ClientAddress}"));

        response.RemoteAddress.ShouldBe(ClientAddress);
        response.XffHopCount.ShouldBe(0);
        response.ForwardingHeaders.Keys.ShouldBe(["x-original-for", "x-azure-clientip"]);
        response.AddressMatches.Keys.ShouldBe(["x-azure-clientip", ProbeFunction.RemoteAddressLocation]);
        response.AddressMatches["x-azure-clientip"].ShouldBe(["x-original-for[0]", "remote-address"]);
        response.AddressMatches["remote-address"].ShouldBe(["x-original-for[0]", "x-azure-clientip"]);
    }

    [Fact]
    public void AConnectionAddressAloneMatchesNothing()
    {
        var response = Measure(new HeaderDictionary(), IPAddress.Loopback);

        response.RemoteAddress.ShouldBe("127.0.0.1");
        response.AddressMatches.Keys.ShouldBe(["remote-address"]);
        response.AddressMatches["remote-address"].ShouldBeEmpty();
    }

    [Fact]
    public void JoinsRepeatedForwardingHeaders()
    {
        var headers = new HeaderDictionary { ["Forwarded"] = new(["for=192.0.2.1", $"for={ClientAddress};proto=https"]) };

        var forwardingHeaders = Measure(headers).ForwardingHeaders;

        forwardingHeaders.Keys.ShouldBe(["forwarded"]);
        forwardingHeaders["forwarded"].ShouldBe($"for=192.0.2.1, for={ClientAddress};proto=https");
    }

    [Fact]
    public void EchoesOnlyTheNamesOfOtherHeaders()
    {
        var headers = new HeaderDictionary
        {
            ["Cookie"] = "wp_probe=1",
            ["x-ms-client-principal"] = ClientPrincipal,
            ["Authorization"] = "Bearer sentinel-token",
        };

        var response = Measure(headers);

        response.ForwardingHeaders.ShouldBeEmpty();
        response.RequestHeaderNames.ShouldBe(["authorization", "cookie", "x-ms-client-principal"]);
        JsonSerializer.Serialize(response).ShouldNotContain("sentinel-token");
        JsonSerializer.Serialize(response).ShouldNotContain(ClientPrincipal);
    }

    [Theory]
    [InlineData("203.0.113.7", "203.0.113.7")]
    [InlineData(" 203.0.113.7 ", "203.0.113.7")]
    [InlineData("203.0.113.7:51234", "203.0.113.7")]
    [InlineData("[2001:db8::1]:443", "2001:db8::1")]
    [InlineData("2001:DB8::1", "2001:db8::1")]
    [InlineData("::ffff:203.0.113.7", "203.0.113.7")]
    [InlineData("unknown", "unknown")]
    [InlineData("_hidden", "_hidden")]
    public void NormalizesAddressesForComparison(string value, string expected)
    {
        ProbeFunction.NormalizeAddress(value).ShouldBe(expected);
    }

    [Fact]
    public async Task NeverLogsProbeValues()
    {
        // Capture every log record at every level while the probe runs and its result is written, the way
        // the ASP.NET Core integration of the worker does.
        var sink = new CapturingLoggerProvider();
        var services = new ServiceCollection();
        services.AddLogging(logging => logging.SetMinimumLevel(LogLevel.Trace).AddProvider(sink));
        services.AddMvcCore();
        services.AddSingleton<IConfiguration>(Enabled());
        await using var provider = services.BuildServiceProvider();
        var httpContext = CreateHttpContext(provider);
        httpContext.Connection.RemoteIpAddress = IPAddress.Parse(EdgeAddress);
        httpContext.Request.Headers["X-Forwarded-For"] = $"{ClientAddress}, {EdgeAddress}";
        httpContext.Request.Headers["X-Original-For"] = $"{ClientAddress}:51234";
        httpContext.Request.Headers["X-Azure-ClientIP"] = ClientAddress;
        httpContext.Request.Headers["X-Forwarded-Host"] = ForwardedHost;
        httpContext.Request.Headers["x-ms-client-principal"] = ClientPrincipal;
        httpContext.Request.Headers.Cookie = "wp_probe=1";

        await RunAsync(ActivatorUtilities.CreateInstance<ProbeFunction>(provider), httpContext);

        ReadBody(httpContext).ShouldContain(ClientAddress, customMessage: "the probe must echo the values to the caller");
        sink.Records.ShouldNotBeEmpty("the capturing logger must see the result execution, or this test proves nothing");
        foreach (var sentinel in new[] { ClientAddress, EdgeAddress, ForwardedHost, ClientPrincipal, "wp_probe" })
        {
            sink.Records.ShouldNotContain(record => record.Contains(sentinel, StringComparison.OrdinalIgnoreCase), customMessage: sentinel);
        }
    }

    [Fact]
    public void AnswersWithTheAppServicesAndNoOtherConfiguration()
    {
        // Only HealthProbe__Enabled: no storage, no feature flags.
        var services = new ServiceCollection();
        var configuration = Enabled();
        services.AddSingleton<IConfiguration>(configuration);
        Program.ConfigureServices(services, configuration);
        using var provider = services.BuildServiceProvider(new ServiceProviderOptions { ValidateOnBuild = true, ValidateScopes = true });
        var httpContext = CreateHttpContext();

        var result = ActivatorUtilities.CreateInstance<ProbeFunction>(provider).Run(httpContext.Request);

        result.ShouldBeOfType<OkObjectResult>().Value.ShouldBeOfType<ProbeResponse>().CookieReceived.ShouldBeFalse();
    }

    private static IConfiguration Enabled() => new ConfigurationBuilder()
        .AddInMemoryCollection(new Dictionary<string, string?> { [ProbeFunction.EnabledSettingKey] = "true" })
        .Build();

    private static ProbeFunction Probe() => new(Enabled());

    private static ProbeFunction Probe(string? settingValue)
    {
        var settings = new Dictionary<string, string?>();
        if (settingValue is not null)
        {
            settings[ProbeFunction.EnabledSettingKey] = settingValue;
        }

        return new ProbeFunction(new ConfigurationBuilder().AddInMemoryCollection(settings).Build());
    }

    private static ProbeResponse Measure(HeaderDictionary headers, IPAddress? remoteAddress = null)
    {
        var httpContext = CreateHttpContext();
        httpContext.Connection.RemoteIpAddress = remoteAddress;
        foreach (var header in headers)
        {
            httpContext.Request.Headers[header.Key] = header.Value;
        }

        return Probe().Run(httpContext.Request)
            .ShouldBeOfType<OkObjectResult>().Value.ShouldBeOfType<ProbeResponse>();
    }

    private static DefaultHttpContext CreateHttpContext(IServiceProvider? services = null)
    {
        if (services is null)
        {
            var collection = new ServiceCollection();
            collection.AddLogging();
            collection.AddMvcCore();
            services = collection.BuildServiceProvider();
        }

        var httpContext = new DefaultHttpContext { RequestServices = services };
        httpContext.Request.Method = HttpMethods.Get;
        httpContext.Request.Path = "/api/health/probe";
        httpContext.Response.Body = new MemoryStream();
        return httpContext;
    }

    /// <summary>Runs the function and executes its result like the ASP.NET Core integration of the worker does.</summary>
    private static Task RunAsync(ProbeFunction function, HttpContext httpContext) =>
        function.Run(httpContext.Request).ExecuteResultAsync(new ActionContext(httpContext, new RouteData(), new ActionDescriptor()));

    private static string ReadBody(HttpContext httpContext)
    {
        httpContext.Response.Body.Position = 0;
        using var reader = new StreamReader(httpContext.Response.Body, leaveOpen: true);
        return reader.ReadToEnd();
    }

    private static JsonElement ReadJson(HttpContext httpContext)
    {
        using var document = JsonDocument.Parse(ReadBody(httpContext));
        return document.RootElement.Clone();
    }

    /// <summary>Records the message, state, scopes and exception of every log call as text.</summary>
    private sealed class CapturingLoggerProvider : ILoggerProvider
    {
        private readonly ConcurrentQueue<string> _records = new();

        public IReadOnlyCollection<string> Records => _records;

        public ILogger CreateLogger(string categoryName) => new CapturingLogger(_records);

        public void Dispose()
        {
        }

        private sealed class CapturingLogger(ConcurrentQueue<string> records) : ILogger
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
                records.Enqueue($"{logLevel} {eventId}: {formatter(state, exception)} | {Describe(state)} | {exception}");
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
}
