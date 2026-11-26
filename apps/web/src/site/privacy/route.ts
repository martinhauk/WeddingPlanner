/** Path of the privacy notice; `/privacy` is an alias. SWA's navigation fallback serves both. */
export const PRIVACY_PATH = '/datenschutz';

/** Id of the imprint block on the privacy page (`/datenschutz#impressum`). */
export const IMPRINT_ID = 'impressum';

/** Whether `pathname` is the privacy notice (`/datenschutz`, `/privacy`, with or without a slash). */
export function isPrivacyPath(pathname: string): boolean {
  return /^\/(?:datenschutz|privacy)\/?$/i.test(pathname);
}
