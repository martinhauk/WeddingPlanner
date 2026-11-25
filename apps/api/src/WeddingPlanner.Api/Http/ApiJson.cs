using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.Unicode;

namespace WeddingPlanner.Api.Http;

/// <summary>
/// The JSON settings of every request and response body the API reads or writes itself: camelCase, nulls
/// omitted, duplicate properties rejected, shallow nesting. Unknown request properties are ignored.
/// </summary>
public static class ApiJson
{
    /// <summary>Media type of JSON responses.</summary>
    public const string ContentType = "application/json; charset=utf-8";

    /// <summary>The shared, read-only serializer options.</summary>
    public static JsonSerializerOptions Options { get; } = CreateOptions();

    private static JsonSerializerOptions CreateOptions()
    {
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web)
        {
            // Names like "Pérez" stay readable; HTML-sensitive characters (<, >, &, ') are still escaped.
            Encoder = JavaScriptEncoder.Create(UnicodeRanges.All),
            DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
            AllowDuplicateProperties = false,
            MaxDepth = 16,
            NumberHandling = JsonNumberHandling.Strict,
        };
        options.MakeReadOnly(populateMissingResolver: true);
        return options;
    }
}
