import {
  devices,
  type PlaywrightTestOptions,
  type PlaywrightWorkerOptions,
} from '@playwright/test';
import type { DeviceProjectName } from './project-names.ts';

type DeviceUse = Partial<PlaywrightTestOptions> & Pick<PlaywrightWorkerOptions, 'browserName'>;

function descriptor(name: string): (typeof devices)[string] {
  const found = devices[name];
  if (found === undefined) {
    throw new Error(`Playwright has no device descriptor "${name}"; update fixtures/devices.ts.`);
  }
  return found;
}

/**
 * Builds a device from a Playwright descriptor (user agent, touch, mobile mode, scale), with the
 * exact viewport of the device matrix. The matrix gives the full screen size (no browser chrome
 * subtracted), so the viewport and the emulated screen are the same.
 */
function fromDescriptor(
  name: string,
  overrides: { width: number; height: number; deviceScaleFactor: number },
): DeviceUse {
  const { defaultBrowserType, ...base } = descriptor(name);
  const size = { width: overrides.width, height: overrides.height };
  return {
    ...base,
    browserName: defaultBrowserType,
    viewport: size,
    screen: size,
    deviceScaleFactor: overrides.deviceScaleFactor,
  };
}

function desktop(width: number, height: number): DeviceUse {
  const { defaultBrowserType: _browser, ...base } = descriptor('Desktop Chrome');
  const size = { width, height };
  return { ...base, browserName: 'chromium', viewport: size, screen: size, deviceScaleFactor: 1 };
}

/**
 * The device matrix ([testing conventions](../../../docs/conventions/testing.md)). Every project
 * emulates `prefers-reduced-motion: reduce`, so screenshots never catch an animation midway.
 *
 * - `iphone-17`: Playwright's own `iPhone 17` descriptor (WebKit, touch, @3x), at 402×874.
 * - `android-budget`: a budget Android phone, Chromium, 360×800 @2x, touch.
 * - `tablet-portrait` / `tablet-landscape`: an iPad (WebKit, touch) at 820×1180 / 1180×820 @2x.
 * - `laptop` / `desktop-fhd`: desktop Chromium at 1366×768 / 1920×1080.
 */
export const DEVICES: Readonly<Record<DeviceProjectName, DeviceUse>> = {
  'iphone-17': fromDescriptor('iPhone 17', { width: 402, height: 874, deviceScaleFactor: 3 }),
  'android-budget': fromDescriptor('Galaxy A55', { width: 360, height: 800, deviceScaleFactor: 2 }),
  'tablet-portrait': fromDescriptor('iPad Pro 11', {
    width: 820,
    height: 1180,
    deviceScaleFactor: 2,
  }),
  'tablet-landscape': fromDescriptor('iPad Pro 11 landscape', {
    width: 1180,
    height: 820,
    deviceScaleFactor: 2,
  }),
  laptop: desktop(1366, 768),
  'desktop-fhd': desktop(1920, 1080),
};

/** Options every project shares, on top of its device. */
export const COMMON_USE = {
  reducedMotion: 'reduce',
  locale: 'en-US',
  timezoneId: 'Europe/Berlin',
  serviceWorkers: 'block',
} as const satisfies Partial<PlaywrightTestOptions>;
