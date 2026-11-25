using System.Security.Cryptography;
using System.Text.RegularExpressions;

namespace WeddingPlanner.Domain.Rsvp;

/// <summary>
/// Stable ids for the people of a reply. Admin matching decisions refer to a person by id, so an update keeps
/// the id of every person the client sends back with a known id; new people get a fresh random id.
/// </summary>
public static partial class PersonIds
{
    /// <summary>Creates a random id: 8 lower-case hex characters.</summary>
    public static string NewId() => Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(4));

    /// <summary>Whether <paramref name="id"/> has the format of a person id (1 to 32 letters, digits, <c>-</c> or <c>_</c>).</summary>
    public static bool IsValid(string? id) => id is not null && IdFormat().IsMatch(id);

    /// <summary>
    /// Returns <paramref name="answer"/> with an id for every person: a requested id is kept when it is in
    /// <paramref name="existingIds"/> and not used twice; every other person gets a new id from
    /// <paramref name="newId"/> (default <see cref="NewId"/>) that is neither in the reply nor an earlier id.
    /// </summary>
    public static RsvpAnswer Assign(RsvpAnswer answer, IEnumerable<string> existingIds, Func<string>? newId = null)
    {
        ArgumentNullException.ThrowIfNull(answer);
        ArgumentNullException.ThrowIfNull(existingIds);
        newId ??= NewId;

        var known = existingIds.ToHashSet(StringComparer.Ordinal);
        var used = new HashSet<string>(StringComparer.Ordinal);

        // First pass: reserve every known id the client sent back (the first occurrence wins).
        var kept = answer.People
            .Select(person => person.Id is { } id && known.Contains(id) && used.Add(id) ? id : null)
            .ToList();

        var people = new List<RsvpPerson>(answer.People.Count);
        for (var index = 0; index < answer.People.Count; index++)
        {
            var id = kept[index];
            if (id is null)
            {
                // Never reuse an id of a removed person: admin decisions made for that person must not move over.
                do
                {
                    id = newId();
                }
                while (known.Contains(id) || !used.Add(id));
            }

            people.Add(answer.People[index] with { Id = id });
        }

        return answer with { People = people };
    }

    [GeneratedRegex("^[A-Za-z0-9_-]{1,32}$", RegexOptions.CultureInvariant)]
    private static partial Regex IdFormat();
}
