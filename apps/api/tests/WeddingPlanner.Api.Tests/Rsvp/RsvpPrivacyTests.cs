using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;

using Shouldly;

using WeddingPlanner.Api.Pipeline;
using WeddingPlanner.Api.Tests.Support;

using Xunit;

namespace WeddingPlanner.Api.Tests.Rsvp;

/// <summary>
/// Logs never contain names, messages, dietary data, tokens, cookies or IP addresses, whatever happens: a full
/// create/read/update/delete cycle, validation failures, misconfiguration and unexpected exceptions.
/// </summary>
public sealed class RsvpPrivacyTests
{
    private const string Name = "Sentinel-Guest-Name";
    private const string Message = "Sentinel private message";
    private const string Note = "Sentinel dietary note";
    private const string ClientAddress = "203.0.113.77";

    [Fact]
    public async Task AFullReplyCycleLogsNoPersonalData()
    {
        using var harness = new RsvpHarness(settings: new Dictionary<string, string?> { ["Rsvp:MaxActiveRsvps"] = "1" });
        var body = new
        {
            attending = true,
            people = new[] { new { name = Name, dietary = new { tags = new[] { "vegan" }, note = Note } } },
            message = Message,
            language = "de",
        };

        var created = await harness.PostAsync(body);
        var cookie = TestHttp.CookieHeader(created);
        await harness.GetMineAsync(cookie);
        await harness.PutMineAsync(cookie, body, "W/\"stale\"");
        await harness.PutMineAsync(cookie, new { attending = true, people = new[] { new { name = Name + new string('x', 100) } }, language = "de" }, "*");
        await harness.PostAsync(body, cookie: cookie);
        await harness.PostAsync(body);
        await harness.GetStatusAsync();
        await harness.DeleteMineAsync(cookie);
        await harness.GetMineAsync(cookie);

        created.Response.StatusCode.ShouldBe(StatusCodes.Status201Created);
        harness.Logs.Records.ShouldNotBeEmpty("the capacity warning must be logged, or this test proves nothing");
        AssertClean(harness.Logs.Records, cookie);
    }

    [Fact]
    public async Task MisconfigurationIsLoggedWithoutValues()
    {
        using var harness = new RsvpHarness(settings: new Dictionary<string, string?> { ["Rsvp:Deadline"] = "Sentinel-Deadline-Value" });

        await harness.PostAsync();

        harness.Logs.Records.ShouldContain(record => record.Contains("RSVP is not configured", StringComparison.Ordinal));
        harness.Logs.Records.ShouldNotContain(record => record.Contains("Sentinel-Deadline-Value", StringComparison.Ordinal));
    }

    [Fact]
    public async Task AnUnexpectedExceptionIsLoggedByTypeOnly()
    {
        var logs = new CapturingLoggerProvider();
        using var factory = LoggerFactory.Create(logging => logging.SetMinimumLevel(LogLevel.Trace).AddProvider(logs));
        var middleware = new ExceptionHandlingMiddleware(factory.CreateLogger<ExceptionHandlingMiddleware>());
        var httpContext = TestFunctionContext.CreateHttpContext();

        await middleware.Invoke(
            new TestFunctionContext("RsvpCreate", httpContext: httpContext),
            _ => throw new InvalidOperationException($"failed for {Name} at {ClientAddress} on storage.example.com"));

        httpContext.Response.StatusCode.ShouldBe(StatusCodes.Status500InternalServerError);
        TestHttp.ReadBody(httpContext).ShouldNotContain(Name);
        logs.Records.ShouldContain(record => record.Contains("System.InvalidOperationException", StringComparison.Ordinal));
        AssertClean(logs.Records, cookie: null);
        logs.Records.ShouldNotContain(record => record.Contains("storage.example.com", StringComparison.Ordinal));
    }

    private static void AssertClean(IReadOnlyCollection<string> records, string? cookie)
    {
        var sentinels = new List<string> { Name, Message, Note, ClientAddress, "vegan", "wp_rsvp" };
        if (cookie is not null)
        {
            sentinels.AddRange(cookie.Split("; ").Select(pair => pair.Split('=', 2)[1]).Where(value => value.Length > 3));
        }

        foreach (var sentinel in sentinels)
        {
            records.ShouldNotContain(record => record.Contains(sentinel, StringComparison.OrdinalIgnoreCase), customMessage: sentinel);
        }
    }
}
