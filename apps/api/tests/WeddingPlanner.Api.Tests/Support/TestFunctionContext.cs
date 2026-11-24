using System.Collections.Immutable;

using Microsoft.AspNetCore.Http;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.DependencyInjection;

using Xunit;

namespace WeddingPlanner.Api.Tests.Support;

/// <summary>
/// Minimal <see cref="FunctionContext"/> for middleware tests: a function name, the services the worker would
/// resolve middleware from, and optionally the ASP.NET Core <see cref="HttpContext"/> of the invocation.
/// </summary>
internal sealed class TestFunctionContext : FunctionContext
{
    /// <summary>
    /// Items key under which the ASP.NET Core integration stores the invocation's <see cref="HttpContext"/>
    /// (read by <c>FunctionContext.GetHttpContext()</c>). <see cref="HttpContextIsVisibleToGetHttpContext"/> guards it.
    /// </summary>
    private const string HttpContextItemsKey = "HttpRequestContext";

    public TestFunctionContext(string functionName, IServiceProvider? services = null, HttpContext? httpContext = null)
    {
        FunctionDefinition = new TestFunctionDefinition(functionName);
        InstanceServices = services ?? new ServiceCollection().BuildServiceProvider();
        if (httpContext is not null)
        {
            Items[HttpContextItemsKey] = httpContext;
        }
    }

    public override string InvocationId { get; } = Guid.NewGuid().ToString("N");

    public override string FunctionId => FunctionDefinition.Id;

    public override TraceContext TraceContext => throw new NotSupportedException();

    public override BindingContext BindingContext => throw new NotSupportedException();

    public override RetryContext RetryContext => throw new NotSupportedException();

    public override IServiceProvider InstanceServices { get; set; }

    public override FunctionDefinition FunctionDefinition { get; }

    public override IDictionary<object, object> Items { get; set; } = new Dictionary<object, object>();

    public override IInvocationFeatures Features => throw new NotSupportedException();

    public override CancellationToken CancellationToken => TestContext.Current.CancellationToken;

    /// <summary>Creates an <see cref="HttpContext"/> whose response body can be read back.</summary>
    public static DefaultHttpContext CreateHttpContext()
    {
        var httpContext = new DefaultHttpContext();
        httpContext.Response.Body = new MemoryStream();
        return httpContext;
    }

    /// <summary>True when the worker's <c>GetHttpContext()</c> finds the context stored by this test double.</summary>
    public static bool HttpContextIsVisibleToGetHttpContext()
    {
        var httpContext = CreateHttpContext();
        return ReferenceEquals(new TestFunctionContext("Any", httpContext: httpContext).GetHttpContext(), httpContext);
    }

    private sealed class TestFunctionDefinition(string name) : FunctionDefinition
    {
        public override ImmutableArray<FunctionParameter> Parameters => [];

        public override string PathToAssembly => typeof(TestFunctionDefinition).Assembly.Location;

        public override string EntryPoint => $"Tests.{name}.Run";

        public override string Id { get; } = Guid.NewGuid().ToString("N");

        public override string Name => name;

        public override IImmutableDictionary<string, BindingMetadata> InputBindings =>
            ImmutableDictionary<string, BindingMetadata>.Empty;

        public override IImmutableDictionary<string, BindingMetadata> OutputBindings =>
            ImmutableDictionary<string, BindingMetadata>.Empty;
    }
}
