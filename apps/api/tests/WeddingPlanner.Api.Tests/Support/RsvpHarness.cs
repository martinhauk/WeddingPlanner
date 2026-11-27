using System.Text.Json;
using System.Text.Json.Nodes;

using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Time.Testing;

using WeddingPlanner.Api.Features.Rsvp;
using WeddingPlanner.Api.Storage;
using WeddingPlanner.Api.Storage.Rsvps;

namespace WeddingPlanner.Api.Tests.Support;

/// <summary>
/// Composes the RSVP feature like <c>Program.cs</c> (same registrations and binding), with a fake clock, a
/// capturing logger and, by default, the in-memory repository. Sample data only: Anna &amp; Ben's fictional wedding.
/// </summary>
internal sealed class RsvpHarness : IDisposable
{
    /// <summary>Deadline of the sample instance: 2099-05-01 23:59 in Berlin (21:59 UTC).</summary>
    public const string Deadline = "2099-05-01T23:59:00+02:00";

    public static readonly DateTimeOffset DeadlineUtc = new(2099, 5, 1, 21, 59, 0, TimeSpan.Zero);

    private readonly Lazy<ServiceProvider> _provider;

    public RsvpHarness(IRsvpRepository? repository = null, IDictionary<string, string?>? settings = null)
    {
        Repository = repository;
        Settings = new Dictionary<string, string?>
        {
            ["Rsvp:Deadline"] = Deadline,
            ["Rsvp:TimeZone"] = "Europe/Berlin",
        };
        foreach (var (key, value) in settings ?? new Dictionary<string, string?>())
        {
            Settings[key] = value;
        }

        _provider = new Lazy<ServiceProvider>(Build);
    }

    public FakeTimeProvider Time { get; } = new(new DateTimeOffset(2099, 4, 1, 10, 0, 0, TimeSpan.Zero));

    public InMemoryRsvpRepository Memory { get; } = new();

    public CapturingLoggerProvider Logs { get; } = new();

    /// <summary>Settings to bind (change before the first function is created).</summary>
    public Dictionary<string, string?> Settings { get; }

    private IRsvpRepository? Repository { get; }

    public IServiceProvider Services => _provider.Value;

    public RsvpCreateFunction CreateFunction() => ActivatorUtilities.CreateInstance<RsvpCreateFunction>(Services);

    public RsvpMineFunctions MineFunctions() => ActivatorUtilities.CreateInstance<RsvpMineFunctions>(Services);

    public RsvpStatusFunction StatusFunction() => ActivatorUtilities.CreateInstance<RsvpStatusFunction>(Services);

    public RsvpClaimFunction ClaimFunction() => ActivatorUtilities.CreateInstance<RsvpClaimFunction>(Services);

    /// <summary>
    /// A fill time well above the minimum (<c>Rsvp__MinSubmitMs</c>), which <see cref="PostAsync"/> adds to a body
    /// without <c>elapsedMs</c>, as the web form does.
    /// </summary>
    public const long HumanElapsedMs = 15_000;

    /// <summary><c>POST /api/rsvp</c>; <paramref name="body"/> gets <see cref="HumanElapsedMs"/> unless it sets <c>elapsedMs</c>.</summary>
    public async Task<HttpContext> PostAsync(object? body = null, string? cookie = null, string? rawBody = null, string? contentType = "application/json")
    {
        var httpContext = TestHttp.Request("POST", "/api/rsvp", WithElapsedMs(body ?? SampleBody()), rawBody, contentType, cookie);
        await RunAsync(httpContext, request => CreateFunction().Run(request, CancellationToken.None));
        return httpContext;
    }

    /// <summary><c>GET /api/rsvp/me</c>.</summary>
    public async Task<HttpContext> GetMineAsync(string? cookie)
    {
        var httpContext = TestHttp.Request("GET", "/api/rsvp/me", cookie: cookie);
        await RunAsync(httpContext, request => MineFunctions().Get(request, CancellationToken.None));
        return httpContext;
    }

    /// <summary><c>PUT /api/rsvp/me</c>.</summary>
    public async Task<HttpContext> PutMineAsync(string? cookie, object body, string? ifMatch)
    {
        var headers = ifMatch is null ? null : new Dictionary<string, string> { ["If-Match"] = ifMatch };
        var httpContext = TestHttp.Request("PUT", "/api/rsvp/me", body, cookie: cookie, headers: headers);
        await RunAsync(httpContext, request => MineFunctions().Update(request, CancellationToken.None));
        return httpContext;
    }

    /// <summary><c>DELETE /api/rsvp/me</c>.</summary>
    public async Task<HttpContext> DeleteMineAsync(string? cookie, string? ifMatch = null)
    {
        var headers = ifMatch is null ? null : new Dictionary<string, string> { ["If-Match"] = ifMatch };
        var httpContext = TestHttp.Request("DELETE", "/api/rsvp/me", cookie: cookie, headers: headers);
        await RunAsync(httpContext, request => MineFunctions().Delete(request, CancellationToken.None));
        return httpContext;
    }

    /// <summary><c>POST /api/rsvp/claim</c> with <c>{editToken}</c> (or <paramref name="rawBody"/>).</summary>
    public async Task<HttpContext> ClaimAsync(string? editToken, string? cookie = null, string? rawBody = null)
    {
        var httpContext = TestHttp.Request("POST", "/api/rsvp/claim", rawBody is null ? new { editToken } : null, rawBody, cookie: cookie);
        await RunAsync(httpContext, request => ClaimFunction().Run(request, CancellationToken.None));
        return httpContext;
    }

    /// <summary>The edit token from the 201 of <see cref="PostAsync"/>.</summary>
    public static string EditToken(HttpContext created) =>
        TestHttp.ReadJson(created).GetProperty("editToken").GetString() ?? throw new InvalidOperationException("no editToken");

    /// <summary><c>GET /api/rsvp/status</c>.</summary>
    public async Task<HttpContext> GetStatusAsync()
    {
        var httpContext = TestHttp.Request("GET", "/api/rsvp/status");
        await RunAsync(httpContext, request => StatusFunction().Run(request, CancellationToken.None));
        return httpContext;
    }

    /// <summary>A valid "yes" for two fictional guests.</summary>
    public static object SampleBody(bool attending = true, string language = "es") => new
    {
        attending,
        people = new object[]
        {
            new { name = "Pablo Pérez", dietary = new { tags = new[] { "vegetarian", "glutenFree" }, note = "Sin nueces" } },
            new { name = "María-José García", dietary = new { tags = new[] { "vegan" } } },
        },
        message = "¡Felicidades, Anna y Ben!",
        language,
        website = string.Empty,
        dietaryConsent = true,
    };

    public void Dispose()
    {
        if (_provider.IsValueCreated)
        {
            _provider.Value.Dispose();
        }
    }

    private static JsonNode? WithElapsedMs(object body)
    {
        var node = JsonSerializer.SerializeToNode(body, JsonSerializerOptions.Web);
        if (node is JsonObject json && !json.ContainsKey("elapsedMs"))
        {
            json["elapsedMs"] = HumanElapsedMs;
        }

        return node;
    }

    private static async Task RunAsync(HttpContext httpContext, Func<HttpRequest, Task<IActionResult>> function)
    {
        var result = await function(httpContext.Request);
        await TestHttp.ExecuteAsync(result, httpContext);
    }

    private ServiceProvider Build()
    {
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(Settings).Build();
        var services = new ServiceCollection();
        services.AddSingleton<IConfiguration>(configuration);
        services.AddLogging(logging => logging.SetMinimumLevel(LogLevel.Trace).AddProvider(Logs));
        services.AddSingleton<TimeProvider>(Time);
        services.AddStorage();
        services.AddRsvpFeature();
        services.AddSingleton(Repository ?? Memory);
        return services.BuildServiceProvider(new ServiceProviderOptions { ValidateOnBuild = true, ValidateScopes = true });
    }
}
