import { eventDate } from '../privacy.ts';
import type { Instance } from '../schema/instance.ts';
import { SITE_LANGUAGES, type SiteLanguage } from '../schema/localizable.ts';
import type { SiteContent } from '../schema/site-content.ts';
import { type Diagnostic, error, jsonPath, warning } from './diagnostics.ts';
import type { FoundText } from './localized-texts.ts';

/**
 * The RSVP deadline guests read must be the one the API enforces (`instance.json` `rsvp.deadline`,
 * shown in `rsvp.timeZone`):
 *
 * - `E_RSVP_DEADLINE`: `site-content.json` `rsvpDeadline` (the date the page shows) is another day.
 *   A deadline at exactly midnight also accepts the day before ("by 1 May" = until 2 May, 00:00).
 * - `W_RSVP_DEADLINE_TEXT`: a text about replying (the RSVP section's intro, a FAQ entry, or any
 *   text with a word like "reply", "zusagen" or "confirmar") names another date. A heuristic, so a
 *   warning: it recognises `2099-05-01`, `1.5.2099`, `1/5/2099` (German and Spanish only), `1. Mai
 *   2099`, `1 May 2099`, `May 1, 2099` and `1 de mayo de 2099`, each also without the year. The
 *   wedding date is allowed in such a text too.
 *
 * Diagnostics carry the JSON path only, never a date.
 */
export function checkRsvpDeadline(
  file: string,
  instance: Instance,
  content: SiteContent,
  texts: readonly FoundText[],
): Diagnostic[] {
  const accepted = deadlineDates(instance.rsvp);
  const diagnostics: Diagnostic[] = [];
  if (content.rsvpDeadline !== undefined && !accepted.includes(content.rsvpDeadline)) {
    diagnostics.push(
      error(
        'E_RSVP_DEADLINE',
        file,
        jsonPath(['rsvpDeadline']),
        'is not the date of instance.json rsvp.deadline in rsvp.timeZone; guests would read another deadline than the one the API enforces',
      ),
    );
  }

  const allowed = [...accepted, eventDate(content.event)].map(parseIsoDate);
  for (const { path, text, context } of replyTexts(content, texts)) {
    for (const language of SITE_LANGUAGES) {
      const value = text[language];
      if (value === undefined || !REPLY_WORDS.test(`${context[language] ?? ''} ${value}`)) {
        continue;
      }
      const stray = findDates(value, language).some(
        (date) => !allowed.some((ok) => sameDay(date, ok)),
      );
      if (stray) {
        diagnostics.push(
          warning(
            'W_RSVP_DEADLINE_TEXT',
            file,
            jsonPath([...path, language]),
            'a text about replying names a date that is not the RSVP deadline of instance.json; check it',
          ),
        );
      }
    }
  }
  return diagnostics;
}

/**
 * The dates (`YYYY-MM-DD`) a page may show for the deadline: its calendar date in `timeZone`, and
 * the day before when the deadline is exactly midnight.
 */
export function deadlineDates(rsvp: {
  readonly deadline: string;
  readonly timeZone: string;
}): string[] {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: rsvp.timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(rsvp.deadline));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value);
  const date = Date.UTC(part('year'), part('month') - 1, part('day'));
  const dates = [isoDate(date)];
  if (part('hour') === 0 && part('minute') === 0 && part('second') === 0) {
    dates.push(isoDate(date - 24 * 60 * 60 * 1000));
  }
  return dates;
}

/** A date found in a text; `year` is absent when the text leaves it out ("by 1 May"). */
export type TextDate = { readonly year?: number; readonly month: number; readonly day: number };

const MONTH_NAMES: ReadonlyArray<readonly [number, readonly string[]]> = [
  [1, ['januar', 'jänner', 'january', 'enero', 'jan.', 'ene.']],
  [2, ['februar', 'february', 'febrero', 'feb.']],
  [3, ['märz', 'maerz', 'march', 'marzo', 'mär.', 'mar.']],
  [4, ['april', 'abril', 'apr.', 'abr.']],
  [5, ['mai', 'may', 'mayo']],
  [6, ['juni', 'june', 'junio', 'jun.']],
  [7, ['juli', 'july', 'julio', 'jul.']],
  [8, ['august', 'agosto', 'aug.', 'ago.']],
  [9, ['september', 'septiembre', 'setiembre', 'sep.', 'sept.']],
  [10, ['oktober', 'october', 'octubre', 'okt.', 'oct.']],
  [11, ['november', 'noviembre', 'nov.']],
  [12, ['dezember', 'december', 'diciembre', 'dez.', 'dec.', 'dic.']],
];

const MONTHS = new Map(
  MONTH_NAMES.flatMap(([month, names]) => names.map((name): [string, number] => [name, month])),
);

// Longest names first, so "juni" wins over "jun.".
const MONTH = [...MONTHS.keys()]
  .sort((a, b) => b.length - a.length)
  .map((name) => name.replace('.', '\\.'))
  .join('|');

const DATE_PATTERNS: ReadonlyArray<{
  readonly pattern: RegExp;
  readonly languages?: readonly SiteLanguage[];
  readonly read: (m: RegExpMatchArray) => TextDate | undefined;
}> = [
  // 2099-05-01
  {
    pattern: /(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/g,
    read: (m) => date(m[3], m[2], m[1]),
  },
  // 1.5.2099, 01.05.99, 1.5.
  {
    pattern: /(?<![\d.])(\d{1,2})\.\s?(\d{1,2})\.(?:\s?(\d{4}|\d{2})(?!\d))?/g,
    read: (m) => date(m[1], m[2], m[3]),
  },
  // 1/5/2099 (day first: German and Spanish only, English may put the month first)
  {
    pattern: /(?<![\d/])(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})(?![\d/])/g,
    languages: ['de', 'es'],
    read: (m) => date(m[1], m[2], m[3]),
  },
  // 1. Mai 2099, 1 May 2099, 1st of May, 1 de mayo de 2099
  {
    pattern: new RegExp(
      `(?<![\\p{L}\\p{N}])(\\d{1,2})(?:\\.|st|nd|rd|th|º)?\\s*(?:de\\s+|of\\s+)?(${MONTH})(?![\\p{L}])(?:,?\\s*(?:del?\\s+)?(\\d{4})(?!\\d))?`,
      'giu',
    ),
    read: (m) => named(m[1], m[2], m[3]),
  },
  // May 1, 2099, May 1st
  {
    pattern: new RegExp(
      `(?<![\\p{L}])(${MONTH})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?!\\d)(?:,?\\s+(\\d{4})(?!\\d))?`,
      'giu',
    ),
    read: (m) => named(m[2], m[1], m[3]),
  },
];

/** The dates written in `text` (see `checkRsvpDeadline` for the formats), in no special order. */
export function findDates(text: string, language: SiteLanguage): TextDate[] {
  const found: TextDate[] = [];
  for (const { pattern, languages, read } of DATE_PATTERNS) {
    if (languages !== undefined && !languages.includes(language)) {
      continue;
    }
    for (const match of text.matchAll(pattern)) {
      const value = read(match);
      if (value !== undefined) {
        found.push(value);
      }
    }
  }
  return found;
}

// Words that make a text about replying, in German, English and Spanish (prefixes, any case).
const REPLY_WORDS =
  /zusag|absag|rückmeld|rueckmeld|antwort|anmeld|bescheid|reply|respon|rsvp|r\.s\.v\.p|let us know|confirm|contest|avis[aá]/i;

type ReplyText = FoundText & {
  /** Text in the same place that makes this one about replying, e.g. the question of a FAQ answer. */
  readonly context: Readonly<Record<string, string | undefined>>;
};

/** Every localized text with the text that tells whether it is about replying. */
function replyTexts(content: SiteContent, texts: readonly FoundText[]): ReplyText[] {
  const rsvpIntros = new Set<object>();
  const faqQuestions = new Map<object, Record<string, string | undefined>>();
  for (const section of content.sections) {
    if (section.type === 'rsvp' && section.data.intro !== undefined) {
      rsvpIntros.add(section.data.intro);
    }
    if (section.type === 'faq') {
      for (const item of section.data.items) {
        faqQuestions.set(item.a, item.q);
      }
    }
  }
  const always = { de: 'rsvp', en: 'rsvp', es: 'rsvp' };
  return texts.map((found) => ({
    ...found,
    context: rsvpIntros.has(found.text) ? always : (faqQuestions.get(found.text) ?? {}),
  }));
}

function date(day?: string, month?: string, year?: string): TextDate | undefined {
  return valid(Number(day), Number(month), year);
}

function named(day?: string, month?: string, year?: string): TextDate | undefined {
  return valid(Number(day), MONTHS.get((month ?? '').toLowerCase()) ?? 0, year);
}

function valid(day: number, month: number, year?: string): TextDate | undefined {
  if (!(day >= 1 && day <= 31 && month >= 1 && month <= 12)) {
    return undefined;
  }
  if (year === undefined) {
    return { month, day };
  }
  const full = year.length === 2 ? 2000 + Number(year) : Number(year);
  return { year: full, month, day };
}

function parseIsoDate(iso: string): TextDate {
  const [year, month, day] = iso.split('-').map(Number);
  return { year: year ?? 0, month: month ?? 0, day: day ?? 0 };
}

function sameDay(found: TextDate, expected: TextDate): boolean {
  return (
    found.month === expected.month &&
    found.day === expected.day &&
    (found.year === undefined || found.year === expected.year)
  );
}

function isoDate(utcMillis: number): string {
  return new Date(utcMillis).toISOString().slice(0, 10);
}
