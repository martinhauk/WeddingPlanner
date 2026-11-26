import type { Lang } from '../i18n.ts';
import type { UiText } from '../ui.ts';

/** Where an Azure region is, for the privacy notice: the EU/EEA, the USA, or another country. */
export type RegionArea = 'eu' | 'us' | 'other';

type Region = { readonly name: UiText; readonly area: RegionArea };

/**
 * Azure regions the instance may use (`instance.json` `swaLocation`, `dataLocation`) with a name a
 * guest understands. An unknown region shows its code and counts as outside the EU.
 */
const REGIONS: Readonly<Record<string, Region>> = {
  germanywestcentral: {
    name: {
      de: 'Germany West Central (Frankfurt am Main, Deutschland)',
      en: 'Germany West Central (Frankfurt, Germany)',
      es: 'Germany West Central (Fráncfort, Alemania)',
    },
    area: 'eu',
  },
  germanynorth: {
    name: {
      de: 'Germany North (Berlin, Deutschland)',
      en: 'Germany North (Berlin, Germany)',
      es: 'Germany North (Berlín, Alemania)',
    },
    area: 'eu',
  },
  westeurope: {
    name: {
      de: 'West Europe (Niederlande)',
      en: 'West Europe (Netherlands)',
      es: 'West Europe (Países Bajos)',
    },
    area: 'eu',
  },
  northeurope: {
    name: {
      de: 'North Europe (Irland)',
      en: 'North Europe (Ireland)',
      es: 'North Europe (Irlanda)',
    },
    area: 'eu',
  },
  swedencentral: {
    name: {
      de: 'Sweden Central (Schweden)',
      en: 'Sweden Central (Sweden)',
      es: 'Sweden Central (Suecia)',
    },
    area: 'eu',
  },
  francecentral: {
    name: {
      de: 'France Central (Paris, Frankreich)',
      en: 'France Central (Paris, France)',
      es: 'France Central (París, Francia)',
    },
    area: 'eu',
  },
  eastus2: {
    name: {
      de: 'East US 2 (Virginia, USA)',
      en: 'East US 2 (Virginia, USA)',
      es: 'East US 2 (Virginia, EE. UU.)',
    },
    area: 'us',
  },
  centralus: {
    name: {
      de: 'Central US (Iowa, USA)',
      en: 'Central US (Iowa, USA)',
      es: 'Central US (Iowa, EE. UU.)',
    },
    area: 'us',
  },
  westus2: {
    name: {
      de: 'West US 2 (Washington, USA)',
      en: 'West US 2 (Washington, USA)',
      es: 'West US 2 (Washington, EE. UU.)',
    },
    area: 'us',
  },
  eastasia: {
    name: { de: 'East Asia (Hongkong)', en: 'East Asia (Hong Kong)', es: 'East Asia (Hong Kong)' },
    area: 'other',
  },
};

const region = (code: string): Region | undefined =>
  Object.hasOwn(REGIONS, code) ? REGIONS[code] : undefined;

/** The region's display name in `lang`, or its code when it is not in the list. */
export function regionName(code: string, lang: Lang): string {
  return region(code)?.name[lang] ?? code;
}

export function regionArea(code: string): RegionArea {
  return region(code)?.area ?? 'other';
}
