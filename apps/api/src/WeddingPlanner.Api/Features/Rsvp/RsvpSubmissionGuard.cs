using Microsoft.AspNetCore.Http;

using WeddingPlanner.Api.Http;

namespace WeddingPlanner.Api.Features.Rsvp;

/// <summary>
/// Cheap checks against automated replies, run right after the body is read and before validation or any storage
/// I/O. On Static Web Apps Free no header carries a trustworthy client address (ADR 0011), so there are no per-guest
/// rate limits; these checks keep simple bots from filling the reply cap. Every refusal is the same 400
/// <c>submission_rejected</c>, which does not say which check failed, so the honeypot stays unnoticed.
/// </summary>
public static class RsvpSubmissionGuard
{
    /// <summary>The problem code of a refused submission.</summary>
    public const string ProblemCode = "submission_rejected";

    /// <summary>
    /// Whether a new reply is refused: the honeypot <c>website</c> is filled in, or the minimum fill time is on and
    /// <c>elapsedMs</c> is missing or below it.
    /// </summary>
    public static bool RejectsCreate(RsvpRequest input, TimeSpan minSubmitTime) => CreateRejection(input, minSubmitTime) is not null;

    /// <summary>
    /// Why a new reply is refused (<see cref="RejectsCreate"/>), or <see langword="null"/> when it passes; only for the
    /// hourly count of refusals (<see cref="RsvpLogThrottle"/>), never for the response.
    /// </summary>
    public static RsvpRejectionReason? CreateRejection(RsvpRequest input, TimeSpan minSubmitTime)
    {
        ArgumentNullException.ThrowIfNull(input);
        return IsHoneypotFilled(input) ? RsvpRejectionReason.Honeypot
            : IsTooFast(input.ElapsedMs, minSubmitTime) ? RsvpRejectionReason.FillTime
            : null;
    }

    /// <summary>Whether a change of an existing reply is refused: the honeypot is filled in (no fill time on edits).</summary>
    public static bool RejectsUpdate(RsvpRequest input)
    {
        ArgumentNullException.ThrowIfNull(input);
        return IsHoneypotFilled(input);
    }

    /// <summary>400 <c>submission_rejected</c>, without any hint at the reason.</summary>
    public static ApiResult Rejected() => ApiProblem.Create(StatusCodes.Status400BadRequest, ProblemCode);

    private static bool IsHoneypotFilled(RsvpRequest input) => !string.IsNullOrWhiteSpace(input.Website);

    private static bool IsTooFast(long? elapsedMs, TimeSpan minSubmitTime) =>
        minSubmitTime > TimeSpan.Zero && (elapsedMs is not { } elapsed || elapsed < (long)minSubmitTime.TotalMilliseconds);
}
