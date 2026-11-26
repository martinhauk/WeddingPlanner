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
      text: text('Wir trafen uns im Zug.\n\nSeitdem reisen wir zusammen.', 'We met on a train.'),
    },
  },
  schedule: {
    id: 'schedule',
    type: 'schedule',
    data: {
      items: [
        { time: '14:00', title: text('Trauung', 'Ceremony'), locationId: 'chapel' },
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
          id: 'chapel',
          name: 'Kapelle am Beispielsee',
          kind: text('Trauung', 'Ceremony'),
          address: 'Beispielweg 1, 99999 Musterstadt',
          lat: 51.1657,
          lng: 10.4515,
        },
      ],
      hotels: [
        {
          name: 'Hotel Seeblick',
          address: 'Uferstraße 10, 99999 Musterstadt',
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
          photo: 'portrait.png',
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
    data: { text: text('Sommerlich elegant.') },
  },
  music: {
    id: 'music',
    type: 'music',
    data: {
      text: text('Wünscht euch einen Song.', 'Request a song.'),
      link: { url: 'https://example.com/playlist' },
    },
  },
  dance: {
    id: 'dance',
    type: 'text',
    title: text("Let's Dance"),
    data: { text: text('Die Tanzfläche gehört euch.', 'The dance floor is yours.') },
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
    data: { intro: text('Wir freuen uns auf eure Antwort.', 'We look forward to your reply.') },
  },
} satisfies Record<string, Section>;

export const content: SiteContent = {
  schemaVersion: 1,
  couple: text('Anna & Ben', 'Anna & Ben', 'Anna y Ben'),
  event: { start: '2099-06-20T14:00:00+02:00', timeZone: 'Europe/Berlin' },
  tagline: text('Wir heiraten', "We're getting married", 'Nos casamos'),
  place: text('Musterstadt'),
  rsvpDeadline: '2099-05-01',
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
  hero: { image: 'hero.png' },
  sections: Object.values(sections),
  privacy: {
    controllers: [{ name: 'Anna', address: 'Beispielweg 1\n99999 Musterstadt' }, { name: 'Ben' }],
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
  rsvpDeadline: '2099-05-01T21:59:00.000Z',
  rsvpTimeZone: 'Europe/Berlin',
  regions: { app: 'eastus2', data: 'germanywestcentral' },
};

export const buildWithoutRsvp: SiteBuild = { ...build, features: { rsvp: false, admin: false } };

/** `content` with other sections. */
export function contentWith(...list: Section[]): SiteContent {
  return { ...content, sections: list };
}
