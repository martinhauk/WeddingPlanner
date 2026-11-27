import { type EnvironmentName, type Instance, instanceSchema } from '../schema/instance.ts';
import { collectLocalizedTexts } from '../schema/localizable.ts';
import { type Site, siteSchema } from '../schema/site.ts';
import type { SiteContent } from '../schema/site-content.ts';
import {
  type Diagnostic,
  diagnosticsFromZod,
  error,
  hasErrors,
  jsonPath,
  warning,
} from './diagnostics.ts';
import { findLocalizedTexts } from './localized-texts.ts';
import { type MediaSource, scanMedia } from './media.ts';
import { readJson } from './read-json.ts';
import { checkRsvpDeadline } from './rsvp-deadline.ts';
import { checkSiteContent, SITE_CONTENT_FILE } from './site-content.ts';

export const INSTANCE_FILE = 'instance.json';
export const SITE_FILE = 'site.json';

export type ValidateOptions = {
  /** Treat missing translations as errors instead of warnings. */
  readonly strict?: boolean;
  /**
   * The environment the instance is checked for. The privacy gate (`E_PRIVACY_MISSING`,
   * `E_PRIVACY_EMAIL`) applies to `production` when `environments.production.features.rsvp` is
   * on. Without an environment every environment counts, so the gate applies whenever production
   * has RSVP on (the instance repo's own check, before any deploy).
   */
  readonly env?: EnvironmentName | undefined;
};

export type ValidationResult = {
  /** `true` when there is no diagnostic with severity `error`. */
  readonly ok: boolean;
  readonly diagnostics: Diagnostic[];
  /** Parsed `instance.json`, when it matches the schema. */
  readonly instance: Instance | undefined;
  /** Parsed `site.json`, when it matches the schema. */
  readonly site: Site | undefined;
  /** Parsed `site-content.json`, when it matches the schema. */
  readonly siteContent: SiteContent | undefined;
  /** Supported, readable images in `media/`, sorted by id. */
  readonly media: MediaSource[];
};

/**
 * Validates an instance directory: `instance.json`, `site.json` (schema and i18n), `media/` and
 * `site-content.json` (schema, references, media, bank details), then the release gates that need
 * both files: the RSVP deadline guests read matches `instance.json`, and the privacy notice is
 * complete where production has RSVP on.
 *
 * Diagnostics carry a code, the file and a JSON path, never values from the files. Missing
 * translations in `site.json` are warnings, or errors with `strict`; in `site-content.json` they
 * are always warnings, because English and Spanish fall back to German there by design.
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

  let siteContent: SiteContent | undefined;
  const contentJson = await readJson(instanceDir, SITE_CONTENT_FILE, diagnostics);
  if (contentJson.ok) {
    const checked = checkSiteContent(contentJson.value, new Set(scanned.media.map((m) => m.id)));
    diagnostics.push(...checked.diagnostics);
    siteContent = checked.content;
    if (instance !== undefined && siteContent !== undefined) {
      diagnostics.push(
        ...checkRsvpDeadline(SITE_CONTENT_FILE, instance, siteContent, checked.texts),
      );
    }
  }

  const gated =
    instance !== undefined && privacyGateApplies(instance, options.env)
      ? diagnostics.map(privacyGate)
      : diagnostics;

  return {
    ok: !hasErrors(gated),
    diagnostics: gated,
    instance,
    site,
    siteContent,
    media: scanned.media,
  };
}

/**
 * Whether guests can reply in production for `env`: `environments.production.features.rsvp` is on
 * and the target is production, or no target is given (then every environment counts).
 */
export function privacyGateApplies(instance: Instance, env: EnvironmentName | undefined): boolean {
  const rsvpInProduction = instance.environments.production?.features.rsvp === true;
  return rsvpInProduction && (env === undefined || env === 'production');
}

/** The privacy warnings and the errors they become where production has RSVP on. */
export const PRIVACY_GATE: Readonly<Record<string, { code: string; message: string }>> = {
  W_PRIVACY_MISSING: {
    code: 'E_PRIVACY_MISSING',
    message:
      'no privacy notice details: production has RSVP on, so the controllers and a contact email are required',
  },
  W_PRIVACY_EMAIL: {
    code: 'E_PRIVACY_EMAIL',
    message: 'no contact email for privacy requests: production has RSVP on, so one is required',
  },
};

function privacyGate(diagnostic: Diagnostic): Diagnostic {
  const gate = PRIVACY_GATE[diagnostic.code];
  return gate === undefined
    ? diagnostic
    : error(gate.code, diagnostic.file, diagnostic.path, gate.message);
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
