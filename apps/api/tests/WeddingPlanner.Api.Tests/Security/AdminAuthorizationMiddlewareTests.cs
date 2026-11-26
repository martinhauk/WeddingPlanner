using System.Text;
using System.Text.Json;

using Microsoft.AspNetCore.Http;

using Shouldly;

using WeddingPlanner.Api.Security;
using WeddingPlanner.Api.Tests.Support;

using Xunit;

namespace WeddingPlanner.Api.Tests.Security;

/// <summary>The admin guard: 401 without a principal, 403 unless role <c>admin</c> via <c>aad</c>, otherwise the function runs.</summary>
public sealed class AdminAuthorizationMiddlewareTests
{
    [Fact]
    public async Task WithoutAPrincipalAnswers401()
    {
        var (httpContext, functionRan) = await InvokeAsync(principal: null);

        functionRan.ShouldBeFalse();
        AssertProblem(httpContext, StatusCodes.Status401Unauthorized, "unauthorized");
    }

    [Theory]
    [InlineData("")]
    [InlineData("not base64!")]
    [InlineData("bnVsbA==")] // "null"
    [InlineData("W10=")] // "[]"
    [InlineData("e30=")] // "{}": no identityProvider
    [InlineData("eyJpZGVudGl0eVByb3ZpZGVyIjoxfQ==")] // {"identityProvider":1}
    [InlineData("e2JhZCBqc29u")] // "{bad json"
    public async Task AMalformedPrincipalCountsAsSignedOut(string header)
    {
        var (httpContext, functionRan) = await InvokeAsync(header);

        functionRan.ShouldBeFalse();
        httpContext.Response.StatusCode.ShouldBe(StatusCodes.Status401Unauthorized);
    }

    [Fact]
    public async Task AnOverlongPrincipalIsNotDecoded()
    {
        var header = Encode("aad", ["admin"], padding: new string('x', ClientPrincipal.MaxHeaderLength));

        var (httpContext, functionRan) = await InvokeAsync(header);

        functionRan.ShouldBeFalse();
        httpContext.Response.StatusCode.ShouldBe(StatusCodes.Status401Unauthorized);
    }

    [Theory]
    [InlineData("aad", new[] { "anonymous", "authenticated" })]
    [InlineData("github", new[] { "anonymous", "authenticated", "admin" })]
    [InlineData("twitter", new[] { "admin" })]
    [InlineData("aad", new string[0])]
    public async Task ASignedInUserWithoutTheAdminRoleOrProviderAnswers403(string provider, string[] roles)
    {
        var (httpContext, functionRan) = await InvokeAsync(Encode(provider, roles));

        functionRan.ShouldBeFalse();
        AssertProblem(httpContext, StatusCodes.Status403Forbidden, "forbidden");
    }

    [Theory]
    [InlineData("aad", new[] { "anonymous", "authenticated", "admin" })]
    [InlineData("AAD", new[] { "Admin" })]
    public async Task AnAdminViaAadPasses(string provider, string[] roles)
    {
        var (httpContext, functionRan) = await InvokeAsync(Encode(provider, roles));

        functionRan.ShouldBeTrue();
        httpContext.Response.StatusCode.ShouldBe(StatusCodes.Status200OK);
    }

    [Fact]
    public void ThePrincipalKeepsNoUserDetails()
    {
        ClientPrincipal.TryParse(Encode("aad", ["admin"]), out var principal).ShouldBeTrue();

        principal.IdentityProvider.ShouldBe("aad");
        principal.UserRoles.ShouldBe(["admin"]);
        principal.ToString().ShouldNotContain("example.com");
    }

    /// <summary>A base64 principal like SWA sends (fictional user).</summary>
    internal static string Encode(string provider, string[] roles, string? padding = null)
    {
        var json = JsonSerializer.Serialize(new
        {
            identityProvider = provider,
            userId = "0f3c6b1e",
            userDetails = "anna@example.com",
            userRoles = roles,
            claims = Array.Empty<object>(),
            padding,
        });
        return Convert.ToBase64String(Encoding.UTF8.GetBytes(json));
    }

    private static void AssertProblem(HttpContext httpContext, int status, string code)
    {
        httpContext.Response.StatusCode.ShouldBe(status);
        httpContext.Response.ContentType.ShouldBe("application/problem+json");
        httpContext.Response.Headers.CacheControl.ToString().ShouldBe("no-store");
        var problem = TestHttp.ReadJson(httpContext);
        problem.GetProperty("status").GetInt32().ShouldBe(status);
        problem.GetProperty("code").GetString().ShouldBe(code);
    }

    private static async Task<(DefaultHttpContext HttpContext, bool FunctionRan)> InvokeAsync(string? principal)
    {
        var httpContext = TestFunctionContext.CreateHttpContext();
        if (principal is not null)
        {
            httpContext.Request.Headers[ClientPrincipal.HeaderName] = principal;
        }

        var functionRan = false;
        await new AdminAuthorizationMiddleware().Invoke(new TestFunctionContext("AdminRsvpsList", httpContext: httpContext), _ =>
        {
            functionRan = true;
            return Task.CompletedTask;
        });
        return (httpContext, functionRan);
    }
}
