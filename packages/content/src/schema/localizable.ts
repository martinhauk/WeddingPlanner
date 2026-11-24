import { z } from 'zod';
import { languageTagSchema } from './common.ts';

let activeCollector: Set<object> | undefined;

/**
 * A text field: a plain string (the same in every language) or `{ <lang>: text }`.
 *
 * Every schema field that holds user-visible text must use this schema (optionally wrapped, e.g.
 * `.optional()`), so `validate` can find it and report missing translations.
 */
export const localizableSchema = z
  .union([z.string(), z.record(languageTagSchema, z.string())])
  .check((payload) => {
    if (activeCollector !== undefined && typeof payload.value === 'object') {
      activeCollector.add(payload.value);
    }
  });

export type Localizable = z.infer<typeof localizableSchema>;

/**
 * Runs `parse` and returns, next to its result, every `{ <lang>: text }` object that passed through
 * `localizableSchema` during the (synchronous) parse. `validate` walks the parsed output to find
 * their JSON paths.
 */
export function collectLocalizedTexts<T>(parse: () => T): { result: T; texts: Set<object> } {
  const texts = new Set<object>();
  const previous = activeCollector;
  activeCollector = texts;
  try {
    return { result: parse(), texts };
  } finally {
    activeCollector = previous;
  }
}
