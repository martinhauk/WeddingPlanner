using System.Text.RegularExpressions;

namespace WeddingPlanner.Domain.Rsvp;

/// <summary>
/// Validates and normalises an <see cref="RsvpDraft"/>. Text is sanitised first (<see cref="TextSanitizer"/>) and
/// then checked against <see cref="RsvpLimits"/>. Dietary data is dropped for a "no": it is only needed for
/// people who come, so it is never stored for anyone else.
/// </summary>
public static partial class RsvpValidator
{
    /// <summary>Validates <paramref name="draft"/> against <paramref name="limits"/>.</summary>
    public static RsvpValidationResult Validate(RsvpDraft draft, RsvpLimits limits)
    {
        ArgumentNullException.ThrowIfNull(draft);
        ArgumentNullException.ThrowIfNull(limits);

        var errors = new List<RsvpValidationError>();

        if (!string.IsNullOrWhiteSpace(draft.Website))
        {
            errors.Add(new("website", RsvpValidationCodes.MustBeEmpty));
        }

        if (draft.Attending is null)
        {
            errors.Add(new("attending", RsvpValidationCodes.Required));
        }

        var attending = draft.Attending ?? false;
        var people = ValidatePeople(draft.People, attending, limits, errors);

        var message = TextSanitizer.MultiLine(draft.Message);
        if (message.Length > RsvpLimits.MaxMessageLength)
        {
            errors.Add(new("message", RsvpValidationCodes.TooLong));
        }

        var language = (draft.Language ?? string.Empty).Trim().ToLowerInvariant();
        if (language.Length == 0)
        {
            errors.Add(new("language", RsvpValidationCodes.Required));
        }
        else if (language.Length > RsvpLimits.MaxLanguageLength || !LanguageTag().IsMatch(language))
        {
            errors.Add(new("language", RsvpValidationCodes.Invalid));
        }

        return errors.Count > 0
            ? RsvpValidationResult.Failure(errors)
            : RsvpValidationResult.Success(new RsvpAnswer(attending, people, message.Length == 0 ? null : message, language));
    }

    private static List<RsvpPerson> ValidatePeople(
        IReadOnlyList<RsvpDraftPerson?>? draftPeople,
        bool attending,
        RsvpLimits limits,
        List<RsvpValidationError> errors)
    {
        var people = new List<RsvpPerson>();
        if (draftPeople is null || draftPeople.Count == 0)
        {
            errors.Add(new("people", RsvpValidationCodes.Required));
            return people;
        }

        if (draftPeople.Count > limits.MaxPeople)
        {
            errors.Add(new("people", RsvpValidationCodes.TooMany));
            return people;
        }

        for (var index = 0; index < draftPeople.Count; index++)
        {
            var field = $"people[{index}]";
            if (draftPeople[index] is not { } draftPerson)
            {
                errors.Add(new(field, RsvpValidationCodes.Required));
                continue;
            }

            var id = draftPerson.Id;
            if (id is not null && !PersonIds.IsValid(id))
            {
                errors.Add(new($"{field}.id", RsvpValidationCodes.Invalid));
            }

            var name = TextSanitizer.SingleLine(draftPerson.Name);
            if (name.Length == 0)
            {
                errors.Add(new($"{field}.name", RsvpValidationCodes.Required));
            }
            else if (name.Length > RsvpLimits.MaxNameLength)
            {
                errors.Add(new($"{field}.name", RsvpValidationCodes.TooLong));
            }

            IReadOnlyList<string> tags = [];
            string? note = null;
            if (attending)
            {
                tags = ValidateTags(draftPerson.DietaryTags, $"{field}.dietary.tags", errors);
                note = TextSanitizer.SingleLine(draftPerson.DietaryNote);
                if (note.Length > RsvpLimits.MaxNoteLength)
                {
                    errors.Add(new($"{field}.dietary.note", RsvpValidationCodes.TooLong));
                }
            }

            people.Add(new RsvpPerson(id, name, tags, string.IsNullOrEmpty(note) ? null : note));
        }

        return people;
    }

    private static List<string> ValidateTags(IReadOnlyList<string?>? draftTags, string field, List<RsvpValidationError> errors)
    {
        if (draftTags is null)
        {
            return [];
        }

        for (var index = 0; index < draftTags.Count; index++)
        {
            if (!DietaryTags.IsKnown(draftTags[index]))
            {
                errors.Add(new($"{field}[{index}]", RsvpValidationCodes.UnknownTag));
            }
        }

        // Canonical order, duplicates removed.
        return DietaryTags.All.Where(tag => draftTags.Contains(tag, StringComparer.Ordinal)).ToList();
    }

    /// <summary>A primary language subtag (2-3 letters), optionally with one region or script subtag.</summary>
    [GeneratedRegex("^[a-z]{2,3}(-[a-z0-9]{2,8})?$", RegexOptions.CultureInvariant)]
    private static partial Regex LanguageTag();
}

/// <summary>Stable error codes of <see cref="RsvpValidationError"/> (part of the API contract).</summary>
public static class RsvpValidationCodes
{
    /// <summary>The value is missing or empty after sanitising.</summary>
    public const string Required = "required";

    /// <summary>The text is longer than its limit.</summary>
    public const string TooLong = "too_long";

    /// <summary>The reply names more people than allowed.</summary>
    public const string TooMany = "too_many";

    /// <summary>A dietary tag that is not one of <see cref="DietaryTags.All"/>.</summary>
    public const string UnknownTag = "unknown_tag";

    /// <summary>The value has the wrong format.</summary>
    public const string Invalid = "invalid";

    /// <summary>The honeypot field was filled in.</summary>
    public const string MustBeEmpty = "must_be_empty";
}

/// <summary>A validation failure of one field.</summary>
/// <param name="Field">Path of the field, for example <c>people[1].name</c> or <c>people[0].dietary.tags[2]</c>.</param>
/// <param name="Code">One of <see cref="RsvpValidationCodes"/>.</param>
public sealed record RsvpValidationError(string Field, string Code);

/// <summary>Either a valid <see cref="RsvpAnswer"/> or the list of errors.</summary>
public sealed class RsvpValidationResult
{
    private RsvpValidationResult(RsvpAnswer? answer, IReadOnlyList<RsvpValidationError> errors)
    {
        Answer = answer;
        Errors = errors;
    }

    /// <summary>The normalised reply, or <see langword="null"/> when <see cref="Errors"/> is not empty.</summary>
    public RsvpAnswer? Answer { get; }

    /// <summary>Every validation error; empty when the draft is valid.</summary>
    public IReadOnlyList<RsvpValidationError> Errors { get; }

    /// <summary>Whether the draft is valid.</summary>
    public bool IsValid => Answer is not null;

    internal static RsvpValidationResult Success(RsvpAnswer answer) => new(answer, []);

    internal static RsvpValidationResult Failure(IReadOnlyList<RsvpValidationError> errors) => new(null, errors);
}
