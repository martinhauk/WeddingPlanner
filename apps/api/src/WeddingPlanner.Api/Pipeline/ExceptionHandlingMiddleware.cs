using Microsoft.AspNetCore.Http;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Middleware;
using Microsoft.Extensions.Logging;

using WeddingPlanner.Api.Http;

namespace WeddingPlanner.Api.Pipeline;

/// <summary>
/// Outermost middleware: an unhandled exception becomes 500 <c>internal_error</c> problem+json with
/// <c>Cache-Control: no-store</c> and no exception details.
/// </summary>
/// <remarks>
/// Only the function name and the exception type are logged. Exception messages are never logged: storage
/// errors carry account host names in their message, and other messages may echo request data.
/// </remarks>
public sealed partial class ExceptionHandlingMiddleware(ILogger<ExceptionHandlingMiddleware> logger) : IFunctionsWorkerMiddleware
{
    public async Task Invoke(FunctionContext context, FunctionExecutionDelegate next)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(next);

        try
        {
            await next(context);
        }
        catch (OperationCanceledException) when (context.CancellationToken.IsCancellationRequested)
        {
            // The caller went away; there is nobody to answer.
        }
        catch (Exception exception)
        {
            LogUnhandled(logger, context.FunctionDefinition.Name, exception.GetType().FullName ?? exception.GetType().Name);

            if (context.GetHttpContext() is { Response.HasStarted: false } httpContext)
            {
                httpContext.Response.Headers.CacheControl = "no-store";
                await ApiProblem.Create(StatusCodes.Status500InternalServerError, ProblemCodes.InternalError)
                    .WriteAsync(httpContext.Response, CancellationToken.None);
            }
        }
    }

    [LoggerMessage(Level = LogLevel.Error, Message = "Function {FunctionName} failed with {ExceptionType}.")]
    private static partial void LogUnhandled(ILogger logger, string functionName, string exceptionType);
}
