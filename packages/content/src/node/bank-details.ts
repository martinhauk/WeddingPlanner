import { type Diagnostic, error, jsonPath } from './diagnostics.ts';

/**
 * Guard against bank details on the public page ("no IBAN" decision: the gifts section says "ask
 * us"). It finds
 *
 * - an IBAN of any country, with or without spaces or hyphens between its groups, in upper or
 *   lower case, that passes the ISO 13616 check (mod 97), so ordinary numbers (phone numbers,
 *   dates, postcodes) never match;
 * - a BIC (SWIFT code) that is labelled as such: `BIC`, `SWIFT`, `SWIFT-Code`, `BIC/SWIFT`, … right
 *   before an 8 or 11 character code in capitals.
 *
 * `validate` runs it on every string of `site-content.json` and `site.json`. Findings name the JSON
 * path only, never the text.
 */

// Country code and IBAN length of every country in the SWIFT IBAN registry.
const IBAN_REGISTRY = `
  AD24 AE23 AL28 AT20 AZ28 BA20 BE16 BG22 BH22 BI27 BR29 BY28 CH21 CR22 CY28 CZ24 DE22 DJ27 DK18
  DO28 EE20 EG29 ES24 FI18 FK18 FO18 FR27 GB22 GE22 GI23 GL18 GR27 GT28 HN28 HR21 HU28 IE22 IL23
  IQ23 IS26 IT27 JO30 KW30 KZ20 LB28 LC32 LI21 LT20 LU20 LV21 LY25 MC27 MD24 ME22 MK19 MN20 MR27
  MT31 MU30 NI28 NL18 NO15 OM23 PK24 PL28 PS29 PT25 QA29 RO24 RS22 RU33 SA24 SC31 SD18 SE24 SI19
  SK24 SM27 SO23 ST25 SV28 TL23 TN24 TR26 UA29 VA22 VG24 XK20 YE30`;

/** IBAN length per country. Other countries are checked by the check digits and mod 97 only. */
export const IBAN_LENGTHS: ReadonlyMap<string, number> = new Map(
  IBAN_REGISTRY.trim()
    .split(/\s+/)
    .map((entry): [string, number] => [entry.slice(0, 2), Number(entry.slice(2))]),
);

const IBAN_MIN = 15;
const IBAN_MAX = 34;

/** True when `iban` (letters and digits only, any case) passes the IBAN check digits and mod 97. */
export function isValidIban(iban: string): boolean {
  const value = iban.toUpperCase();
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]+$/.test(value)) {
    return false;
  }
  if (value.length < IBAN_MIN || value.length > IBAN_MAX) {
    return false;
  }
  const expected = IBAN_LENGTHS.get(value.slice(0, 2));
  if (expected !== undefined && value.length !== expected) {
    return false;
  }
  // ISO 13616 check digits are 02 to 98.
  const check = Number(value.slice(2, 4));
  if (check < 2 || check > 98) {
    return false;
  }
  // Move the first four characters to the end, letters become 10..35, then the number mod 97 is 1.
  let remainder = 0;
  for (const char of value.slice(4) + value.slice(0, 4)) {
    const digits = /[0-9]/.test(char) ? char : String(char.charCodeAt(0) - 55);
    for (const digit of digits) {
      remainder = (remainder * 10 + Number(digit)) % 97;
    }
  }
  return remainder === 1;
}

// Separators people put between the groups of an IBAN: a space, a no-break or narrow no-break space,
// or a hyphen (ASCII, U+2010 or the no-break hyphen U+2011).
const GROUP_SEPARATOR = /[ \u00A0\u202F\u2010\u2011-]/;
const ALNUM = /[A-Za-z0-9]/;
// Start of a possible IBAN: two letters and two digits that do not continue a word or number.
const IBAN_START = /(?<![\p{L}\p{N}])[A-Za-z]{2}[0-9]{2}/gu;

/** Whether `text` contains a valid IBAN (see the module comment). */
export function containsIban(text: string): boolean {
  for (const match of text.matchAll(IBAN_START)) {
    const characters = ibanCharacters(text, match.index);
    const country = characters.slice(0, 2).toUpperCase();
    const length = IBAN_LENGTHS.get(country);
    if (length !== undefined) {
      if (characters.length >= length && isValidIban(characters.slice(0, length))) {
        return true;
      }
    } else if (
      // Not in the registry (yet): only an upper-case run that is a complete IBAN by itself.
      characters === characters.toUpperCase() &&
      isValidIban(characters)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * The letters and digits from `start` on, skipping single group separators, up to the longest
 * IBAN. Stops at anything else (punctuation, a line break, two spaces).
 */
function ibanCharacters(text: string, start: number): string {
  let out = '';
  let index = start;
  while (index < text.length && out.length < IBAN_MAX) {
    const char = text.charAt(index);
    if (ALNUM.test(char)) {
      out += char;
      index += 1;
    } else if (GROUP_SEPARATOR.test(char) && ALNUM.test(text.charAt(index + 1))) {
      index += 1;
    } else {
      break;
    }
  }
  return out;
}

// "BIC", "SWIFT", "SWIFT-Code", "BIC/SWIFT", "SWIFT (BIC)", "Código SWIFT", … then an optional
// colon, then a code: 4 letters (bank), 2 letters (country), 2 letters or digits (location) and an
// optional 3-character branch. The label is matched in any case, the code must be in capitals.
// Whitespace runs are bounded ({0,3}), so the pattern cannot backtrack polynomially on long runs of
// spaces (texts come from the instance, and the Vite plugin runs this on every build).
const LABELLED_BIC =
  /(?<![\p{L}\p{N}])(?:BIC|SWIFT)(?:\s{0,3}[/(-]?\s{0,3}(?:BIC|SWIFT|code|kode)\)?)?\s{0,3}:?\s{0,3}([A-Za-z]{6}[A-Za-z0-9]{2}(?:[A-Za-z0-9]{3})?)(?![\p{L}\p{N}])/giu;

/** Whether `text` contains a BIC that is labelled as one (see the module comment). */
export function containsLabelledBic(text: string): boolean {
  for (const match of text.matchAll(LABELLED_BIC)) {
    const code = match[1] ?? '';
    if (code === code.toUpperCase()) {
      return true;
    }
  }
  return false;
}

/** Whether `text` contains an IBAN or a labelled BIC. */
export function containsBankDetails(text: string): boolean {
  return containsIban(text) || containsLabelledBic(text);
}

/**
 * Every string of the content (texts in every language, names, addresses, notes, links) that
 * contains bank details: one `E_BANK_DETAILS` error per string, at its JSON path.
 */
export function checkBankDetails(file: string, content: unknown): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const visit = (node: unknown, at: PropertyKey[]): void => {
    if (typeof node === 'string') {
      if (containsBankDetails(node)) {
        diagnostics.push(
          error(
            'E_BANK_DETAILS',
            file,
            jsonPath(at),
            'looks like bank details (an IBAN or a BIC); the public page never shows them: write "ask us" instead',
          ),
        );
      }
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((child, index) => {
        visit(child, [...at, index]);
      });
      return;
    }
    if (typeof node === 'object' && node !== null) {
      for (const [key, child] of Object.entries(node)) {
        if (key !== '$schema') {
          visit(child, [...at, key]);
        }
      }
    }
  };
  visit(content, []);
  return diagnostics;
}
