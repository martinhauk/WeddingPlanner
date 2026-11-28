using System.Text.Json;

using Microsoft.AspNetCore.Http;

using Shouldly;

using WeddingPlanner.Api.Http;
using WeddingPlanner.Api.Tests.Support;

using Xunit;

namespace WeddingPlanner.Api.Tests.Http;

public sealed class ApiProblemTests
{
    [Fact]
    public async Task WritesRfc9457ProblemDetailsWithACode()
    {
        var httpContext = TestFunctionContext.CreateHttpContext();

        await ApiProblem.Create(
                StatusCodes.Status429TooManyRequests,
                ProblemCodes.RateLimited,
                detail: "Slow down.",
                extensions: new Dictionary<string, object?> { ["errors"] = new[] { new { field = "people", code = "too_many" } } })
            .WriteAsync(httpContext.Response, CancellationToken.None);

        httpContext.Response.StatusCode.ShouldBe(429);
        httpContext.Response.ContentType.ShouldBe("application/problem+json");
        var problem = TestHttp.ReadJson(httpContext);
        problem.EnumerateObject().Select(property => property.Name).ShouldBe(["type", "title", "status", "code", "detail", "errors"]);
        problem.GetProperty("type").GetString().ShouldBe("https://tools.ietf.org/html/rfc6585#section-4");
        problem.GetProperty("title").GetString().ShouldBe("Too Many Requests");
        problem.GetProperty("status").GetInt32().ShouldBe(429);
        problem.GetProperty("code").GetString().ShouldBe("rate_limited");
        problem.GetProperty("errors")[0].GetProperty("field").GetString().ShouldBe("people");
    }

    [Fact]
    public void UsesAboutBlankForUnmappedStatusCodes()
    {
        var result = ApiProblem.Create(StatusCodes.Status418ImATeapot, "teapot");

        using var problem = JsonDocument.Parse(result.Body);
        problem.RootElement.GetProperty("type").GetString().ShouldBe("about:blank");
    }

    [Fact]
    public async Task JsonResultsAreCamelCaseWithoutNulls()
    {
        var httpContext = TestFunctionContext.CreateHttpContext();

        await ApiResult.Json(StatusCodes.Status200OK, new Sample("Anna", null, new DateTime(2099, 7, 1, 21, 59, 0, DateTimeKind.Utc)))
            .WriteAsync(httpContext.Response, CancellationToken.None);

        httpContext.Response.ContentType.ShouldBe("application/json; charset=utf-8");
        TestHttp.ReadBody(httpContext).ShouldBe("{\"firstName\":\"Anna\",\"at\":\"2099-07-01T21:59:00Z\"}");
    }

    [Fact]
    public async Task KeepsUnicodeReadableButEscapesHtmlSensitiveCharacters()
    {
        var httpContext = TestFunctionContext.CreateHttpContext();

        await ApiResult.Json(StatusCodes.Status200OK, new Sample("María-José García", "<b>Müller</b> & Co", DateTime.MinValue))
            .WriteAsync(httpContext.Response, CancellationToken.None);

        var body = TestHttp.ReadBody(httpContext);
        body.ShouldContain("\"firstName\":\"María-José García\"");
        body.ShouldContain("Müller");
        body.ShouldNotContain("<b>");
        body.ShouldNotContain("&");
    }

    private sealed record Sample(string FirstName, string? LastName, DateTime At);
}
