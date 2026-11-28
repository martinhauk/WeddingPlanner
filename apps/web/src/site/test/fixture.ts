import type { Section, SiteContent } from '@weddingplanner/content';
import type { SiteBuild } from '../sections/types.ts';

// Small fictional fixture (Anna & Ben, invented places, far-future dates); never real content.

const text = (de: string, en?: string, es?: string) => ({
  de,
  ...(en === undefined ? {} : { en }),
  ...(es === undefined ? {} : { es }),
});

export const sections = {
  story: {
    id: 'story',
    type: 'story',
    data: {
      text: text(
        'Wir trafen uns im Gemeinschaftsgarten.\n\nSeitdem gießen wir zusammen.',
        'We met in a community garden.',
      ),
    },
  },
  schedule: {
    id: 'schedule',
    type: 'schedule',
    data: {
      items: [
        { time: '11:00', title: text('Trauung', 'Ceremony'), locationId: 'villa' },
        { time: '18:00', title: text('Abendessen', 'Dinner'), note: text('Im Garten', 'Outside') },
      ],
    },
  },
  locations: {
    id: 'travel',
    type: 'locations',
    title: text('Anreise', 'Travel'),
    data: {
      cards: [
        {
          id: 'villa',
          name: 'Villa Lindenufer',
          kind: text('Trauung', 'Ceremony'),
          address: 'Uferpromenade 14, 12435 Berlin',
          lat: 52.4894,
          lng: 13.4712,
        },
      ],
      hotels: [
        {
          name: 'Hotel Spreewelle',
          address: 'Uferpromenade 30, 12435 Berlin',
          url: 'https://example.com/hotel',
        },
      ],
    },
  },
  weddingParty: {
    id: 'wedding-party',
    type: 'weddingParty',
    data: {
      people: [
        {
          name: 'Pablo Pérez',
          role: text('Trauzeuge', 'Best man', 'Testigo'),
          photo: 'party-1.webp',
          text: text('Pablo kennt Ben seit der Schule.', 'Pablo has known Ben since school.'),
        },
        {
          name: 'María-José García',
          role: text('Trauzeugin', 'Maid of honour'),
          text: text('María-José ist Annas beste Freundin.'),
        },
      ],
    },
  },
  dresscode: {
    id: 'dresscode',
    type: 'dresscode',
    visible: false,
    data: { text: text('Festlich, aber bequem.') },
  },
  music: {
    id: 'music',
    type: 'music',
    data: {
      text: text('Wünscht euch einen Song.', 'Request a song.'),
      link: { url: 'https://example.com/playlist' },
    },
  },
  tips: {
    id: 'berlin-tips',
    type: 'text',
    title: text('Schon am Freitag in Berlin?'),
    data: { text: text('Ein paar Tipps für den Tag davor.', 'A few tips for the day before.') },
  },
  faq: {
    id: 'faq',
    type: 'faq',
    nav: text('Fragen', 'FAQ'),
    data: {
      items: [{ q: text('Kinder?', 'Children?'), a: text('Nur Erwachsene.', 'Adults only.') }],
    },
  },
  gifts: {
    id: 'gifts',
    type: 'gifts',
    data: { text: text('Eure Anwesenheit ist Geschenk genug.') },
  },
  contact: {
    id: 'contact',
    type: 'contact',
    data: {
      people: [
        {
          name: 'Anna',
          phone: '+49 151 0000 0000',
          email: 'anna@example.com',
          whatsapp: '+49 151 00000000',
        },
        { name: 'Ben', email: 'ben@example.com' },
      ],
    },
  },
  rsvp: {
    id: 'rsvp',
    type: 'rsvp',
    nav: text('Zusagen', 'RSVP'),
    data: {
      intro: text(
        'Ein Nein hilft uns beim Planen genauso wie ein Ja.',
        'A no helps us plan just as much as a yes.',
      ),
    },
  },
} satisfies Record<string, Section>;

export const content: SiteContent = {
  schemaVersion: 1,
  couple: text('Anna & Ben', 'Anna & Ben', 'Anna y Ben'),
  event: { start: '2099-09-26T11:00:00+02:00', timeZone: 'Europe/Berlin' },
  tagline: text('Wir heiraten', "We're getting married", 'Nos casamos'),
  place: text('Berlin'),
  rsvpDeadline: '2099-07-01',
  theme: {
    colors: {
      bg: '#faf7f2',
      paper: '#fffdf9',
      ink: '#2f2b27',
      muted: '#6f675f',
      accent: '#7d8e70',
      accentDark: '#5b6a51',
      line: '#e7e0d6',
    },
    fonts: { heading: 'cormorant-garamond', body: 'jost' },
  },
  hero: { image: 'hero.webp' },
  sections: Object.values(sections),
  privacy: {
    controllers: [{ name: 'Anna', address: 'Beispielstraße 7\n12045 Berlin' }, { name: 'Ben' }],
    email: 'anna@example.com',
    extra: [
      {
        title: text('Fotos', 'Photos'),
        text: text('Es wird fotografiert.', 'Photos will be taken.'),
      },
    ],
  },
};

export const build: SiteBuild = {
  features: { rsvp: true, admin: true },
  rsvpDeadline: '2099-07-01T21:59:00.000Z',
  rsvpTimeZone: 'Europe/Berlin',
  regions: { app: 'eastus2', data: 'germanywestcentral' },
};

export const buildWithoutRsvp: SiteBuild = { ...build, features: { rsvp: false, admin: false } };

/** `content` with other sections. */
export function contentWith(...list: Section[]): SiteContent {
  return { ...content, sections: list };
}
