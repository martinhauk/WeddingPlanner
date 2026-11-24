import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { type Instance, instanceSchema } from '../schema/instance.ts';
import { collectLocalizedTexts } from '../schema/localizable.ts';
import { type Site, siteSchema } from '../schema/site.ts';
import {
  type Diagnostic,
  diagnosticsFromZod,
  error,
  hasErrors,
  jsonPath,
  warning,
} from './diagnostics.ts';
import { type MediaSource, scanMedia } from './media.ts';

export const INSTANCE_FILE = 'instance.json';
export const SITE_FILE = 'site.json';

export type ValidateOptions = {
  /** Treat missing translations as errors instead of warnings. */
  readonly strict?: boolean;
};

export type ValidationResult = {
  /** `true` when there is no diagnostic with severity `error`. */
  readonly ok: boolean;
  readonly diagnostics: Diagnostic[];
  /** Parsed `instance.json`, when it matches the schema. */
  readonly instance: Instance | undefined;
  /** Parsed `site.json`, when it matches the schema. */
  readonly site: Site | undefined;
  /** Supported, readable images in `media/`, sorted by id. */
  readonly media: MediaSource[];
};

/**
 * Validates an instance directory: `instance.json`, `site.json` (schema and i18n) and `media/`.
 *
 * Diagnostics carry a code, the file and a JSON path, never values from the files. Missing
 * translations are warnings, or errors with `strict`.
 */
export async function validate(
  instanceDir: string,
  options: ValidateOptions = {},
): Promise<ValidationResult> {
  const strict = options.strict ?? false;
  const diagnostics: Diagnostic[] = [];

  let instance: Instance | undefined;
  const instanceJson = await readJson(instanceDir, INSTANCE_FILE, diagnostics);
  if (instanceJson.ok) {
    const parsed = instanceSchema.safeParse(instanceJson.value, { reportInput: true });
    if (parsed.success) {
      instance = parsed.data;
    } else {
      diagnostics.push(...diagnosticsFromZod(INSTANCE_FILE, parsed.error));
    }
  }

  let site: Site | undefined;
  const siteJson = await readJson(instanceDir, SITE_FILE, diagnostics);
  if (siteJson.ok) {
    const { result: parsed, texts } = collectLocalizedTexts(() =>
      siteSchema.safeParse(siteJson.value, { reportInput: true }),
    );
    if (parsed.success) {
      site = parsed.data;
      diagnostics.push(...checkSite(parsed.data, texts, strict));
    } else {
      diagnostics.push(...diagnosticsFromZod(SITE_FILE, parsed.error));
    }
  }

  const scanned = await scanMedia(instanceDir);
  diagnostics.push(...scanned.diagnostics);

  return { ok: !hasErrors(diagnostics), diagnostics, instance, site, media: scanned.media };
}

async function readJson(
  dir: string,
  file: string,
  diagnostics: Diagnostic[],
): Promise<{ ok: true; value: unknown } | { ok: false }> {
  let text: string;
  try {
    text = await readFile(path.join(dir, file), 'utf8');
  } catch (cause) {
    const code = cause instanceof Error && 'code' in cause ? cause.code : undefined;
    if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'EISDIR') {
      diagnostics.push(error('E_FILE_MISSING', file, '$', 'file not found'));
      return { ok: false };
    }
    throw cause;
  }
  try {
    return { ok: true, value: JSON.parse(text.replace(/^﻿/, '')) };
  } catch {
    // The parser's message can quote file content, so it is not passed on.
    diagnostics.push(error('E_JSON', file, '$', 'is not valid JSON'));
    return { ok: false };
  }
}

/** Semantic checks Zod cannot express: language settings, event range, translations. */
function checkSite(site: Site, localizedTexts: Set<object>, strict: boolean): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const { languages, defaultLanguage } = site.i18n;

  languages.forEach((language, index) => {
    if (languages.indexOf(language) !== index) {
      diagnostics.push(
        error(
          'E_LANG_DUP',
          SITE_FILE,
          jsonPath(['i18n', 'languages', index]),
          'duplicate language',
        ),
      );
    }
  });
  if (!languages.includes(defaultLanguage)) {
    diagnostics.push(
      error('E_LANG_DEFAULT', SITE_FILE, '$.i18n.defaultLanguage', 'must be one of i18n.languages'),
    );
  }

  if (site.event.end !== undefined && Date.parse(site.event.end) < Date.parse(site.event.start)) {
    diagnostics.push(
      error('E_EVENT_RANGE', SITE_FILE, '$.event.end', 'must not be before event.start'),
    );
  }

  const configured = new Set(languages);
  for (const { path: textPath, text } of findLocalizedTexts(site, localizedTexts)) {
    for (const key of Object.keys(text)) {
      if (!configured.has(key)) {
        diagnostics.push(
          error(
            'E_I18N_UNKNOWN_LANG',
            SITE_FILE,
            jsonPath([...textPath, key]),
            'language is not listed in i18n.languages',
          ),
        );
      }
    }
    for (const language of configured) {
      const value = text[language];
      if (value === undefined || value.trim() === '') {
        const at = jsonPath([...textPath, language]);
        diagnostics.push(
          strict
            ? error('E_I18N_MISSING', SITE_FILE, at, 'missing translation')
            : warning('W_I18N_MISSING', SITE_FILE, at, 'missing translation'),
        );
      }
    }
  }
  return diagnostics;
}

type LocalizedText = { path: PropertyKey[]; text: Record<string, string | undefined> };

/** Finds the JSON paths of the `{ <lang>: text }` objects collected while parsing. */
function findLocalizedTexts(root: unknown, targets: Set<object>): LocalizedText[] {
  const found: LocalizedText[] = [];
  const visit = (node: unknown, at: PropertyKey[]): void => {
    if (typeof node !== 'object' || node === null) {
      return;
    }
    if (targets.has(node)) {
      found.push({ path: at, text: node as Record<string, string | undefined> });
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((child, index) => {
        visit(child, [...at, index]);
      });
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      visit(child, [...at, key]);
    }
  };
  visit(root, []);
  return found;
}
