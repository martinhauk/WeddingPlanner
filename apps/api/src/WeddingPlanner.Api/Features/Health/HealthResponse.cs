namespace WeddingPlanner.Api.Features.Health;

/// <summary>Body of <c>GET /api/health</c>.</summary>
/// <param name="Status">Always <c>ok</c> when the worker answers.</param>
/// <param name="Version">Assembly informational version, including the source revision (commit SHA).</param>
/// <param name="TimeUtc">Server time in UTC.</param>
public sealed record HealthResponse(string Status, string Version, DateTime TimeUtc);
