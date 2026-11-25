using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging.Abstractions;

using Shouldly;

using WeddingPlanner.Api.Pipeline;
using WeddingPlanner.Api.Tests.Support;

using Xunit;

namespace WeddingPlanner.Api.Tests.Pipeline;

public sealed class ExceptionHandlingMiddlewareTests
{
    [Fact]
    public async Task TurnsAnUnhandledExceptionIntoAnInternalErrorProblem()
    {
        var httpContext = TestFunctionContext.CreateHttpContext();

        await new ExceptionHandlingMiddleware(NullLogger<ExceptionHandlingMiddleware>.Instance).Invoke(
            new TestFunctionContext("RsvpCreate", httpContext: httpContext),
            _ => throw new InvalidOperationException("secret detail"));

        httpContext.Response.StatusCode.ShouldBe(StatusCodes.Status500InternalServerError);
        httpContext.Response.ContentType.ShouldBe("application/problem+json");
        httpContext.Response.Headers.CacheControl.ToString().ShouldBe("no-store");
        var body = TestHttp.ReadBody(httpContext);
        body.ShouldNotContain("secret detail");
        body.ShouldNotContain("InvalidOperationException");
        var problem = TestHttp.ReadJson(httpContext);
        problem.GetProperty("code").GetString().ShouldBe("internal_error");
        problem.GetProperty("status").GetInt32().ShouldBe(500);
        problem.GetProperty("title").GetString().ShouldBe("Internal Server Error");
    }

    [Fact]
    public async Task PassesThroughWhenNothingFails()
    {
        var httpContext = TestFunctionContext.CreateHttpContext();
        var ran = false;

        await new ExceptionHandlingMiddleware(NullLogger<ExceptionHandlingMiddleware>.Instance).Invoke(
            new TestFunctionContext("Health", httpContext: httpContext),
            _ =>
            {
                ran = true;
                return Task.CompletedTask;
            });

        ran.ShouldBeTrue();
        httpContext.Response.StatusCode.ShouldBe(StatusCodes.Status200OK);
    }
}
