/**
 * The device-matrix project names, in display order (phone → tablet → desktop). They are a contract
 * with CI (`ci.yml` runs one project per matrix job) and the contact sheet sorts by this order.
 *
 * Kept free of Playwright imports so the contact-sheet CLI can run under plain `node`.
 */
export const DEVICE_PROJECT_NAMES = [
  'iphone-17',
  'android-budget',
  'tablet-portrait',
  'tablet-landscape',
  'laptop',
  'desktop-fhd',
] as const;

export type DeviceProjectName = (typeof DEVICE_PROJECT_NAMES)[number];

/** The project of the read-only smoke suite. */
export const SMOKE_PROJECT_NAME = 'smoke';
