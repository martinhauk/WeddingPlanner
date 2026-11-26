import { type AdminTotals, DIETARY_TAGS } from './api.ts';
import { de, dietaryLabel } from './strings.ts';

/** The totals as a grid of cards: replies, headcount, dietary counts. */
export function TotalsCards({ totals }: { readonly totals: AdminTotals }) {
  const cards: { label: string; value: number; highlight?: boolean }[] = [
    { label: de.totals.attendingPeople, value: totals.attendingPeople, highlight: true },
    { label: de.totals.yes, value: totals.yes },
    { label: de.totals.no, value: totals.no },
    { label: de.totals.declinedPeople, value: totals.declinedPeople },
    { label: de.totals.replies, value: totals.replies },
    ...DIETARY_TAGS.map((tag) => ({ label: dietaryLabel(tag), value: totals.dietary[tag] ?? 0 })),
    { label: de.totals.dietaryNotes, value: totals.dietaryNotes },
    { label: de.totals.messages, value: totals.messages },
  ];

  return (
    <ul className="admin-totals" aria-label="Summen">
      {cards.map((card) => (
        <li
          key={card.label}
          className={card.highlight === true ? 'admin-total highlight' : 'admin-total'}
        >
          <span className="admin-total-value">{card.value}</span>
          <span className="admin-total-label">{card.label}</span>
        </li>
      ))}
    </ul>
  );
}
