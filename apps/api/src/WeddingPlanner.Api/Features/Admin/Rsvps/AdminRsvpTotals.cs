using WeddingPlanner.Api.Storage.Rsvps;
using WeddingPlanner.Domain.Rsvp;

namespace WeddingPlanner.Api.Features.Admin.Rsvps;

/// <summary>Totals over all replies, for the admin overview.</summary>
/// <param name="Replies">Number of replies.</param>
/// <param name="Yes">Replies that accept.</param>
/// <param name="No">Replies that decline.</param>
/// <param name="AttendingPeople">Headcount: people in accepting replies.</param>
/// <param name="DeclinedPeople">People named in declining replies.</param>
/// <param name="Dietary">Attending people per dietary tag; every tag of <see cref="DietaryTags.All"/> is present.</param>
/// <param name="DietaryNotes">Attending people with a dietary note.</param>
/// <param name="Messages">Replies with a message to the couple.</param>
public sealed record AdminRsvpTotals(
    int Replies,
    int Yes,
    int No,
    int AttendingPeople,
    int DeclinedPeople,
    IReadOnlyDictionary<string, int> Dietary,
    int DietaryNotes,
    int Messages)
{
    /// <summary>Computes the totals of <paramref name="records"/>.</summary>
    public static AdminRsvpTotals From(IEnumerable<RsvpRecord> records)
    {
        ArgumentNullException.ThrowIfNull(records);

        var answers = records.Select(record => record.Answer).ToList();
        var attending = answers.Where(answer => answer.Attending).SelectMany(answer => answer.People).ToList();

        // Insertion order is the canonical tag order, so the JSON object lists the tags in that order too.
        var dietary = new Dictionary<string, int>(StringComparer.Ordinal);
        foreach (var tag in DietaryTags.All)
        {
            dietary[tag] = attending.Count(person => person.DietaryTags.Contains(tag, StringComparer.Ordinal));
        }

        return new AdminRsvpTotals(
            answers.Count,
            answers.Count(answer => answer.Attending),
            answers.Count(answer => !answer.Attending),
            attending.Count,
            answers.Where(answer => !answer.Attending).Sum(answer => answer.People.Count),
            dietary,
            attending.Count(person => !string.IsNullOrEmpty(person.DietaryNote)),
            answers.Count(answer => !string.IsNullOrEmpty(answer.Message)));
    }
}
