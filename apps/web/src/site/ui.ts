import type { SectionType } from '@weddingplanner/content';
import type { Lang } from './i18n.ts';

/**
 * UI strings of the one-pager (buttons, labels, default headings), complete in every language.
 * Content texts come from the instance's `site-content.json` instead.
 */
export type UiText = Readonly<Record<Lang, string>>;

/** Default heading per section type; a section's `title` overrides it. `text` has none. */
export const sectionTitles: Readonly<Partial<Record<SectionType, UiText>>> = {
  story: { de: 'Unsere Geschichte', en: 'Our story', es: 'Nuestra historia' },
  schedule: { de: 'Ablauf', en: 'Schedule', es: 'Programa' },
  locations: { de: 'Anreise', en: 'Getting there', es: 'Cómo llegar' },
  weddingParty: { de: 'Trauzeugen', en: 'Wedding party', es: 'Testigos' },
  dresscode: { de: 'Dresscode', en: 'Dress code', es: 'Vestimenta' },
  music: { de: 'Musik', en: 'Music', es: 'Música' },
  faq: { de: 'Fragen', en: 'FAQ', es: 'Preguntas' },
  gifts: { de: 'Geschenke', en: 'Gifts', es: 'Regalos' },
  contact: { de: 'Kontakt', en: 'Contact', es: 'Contacto' },
  rsvp: { de: 'Seid ihr dabei?', en: 'Will you join us?', es: '¿Vendréis?' },
};

export const ui = {
  menu: { de: 'Menü', en: 'Menu', es: 'Menú' },
  navigation: { de: 'Hauptnavigation', en: 'Main navigation', es: 'Navegación principal' },
  language: { de: 'Sprache', en: 'Language', es: 'Idioma' },
  rsvpCta: { de: 'Zusagen', en: 'RSVP', es: 'Confirmar' },
  countdown: {
    label: { de: 'Countdown bis zur Hochzeit', en: 'Countdown to the wedding', es: 'Cuenta atrás' },
    days: { de: 'Tage', en: 'Days', es: 'Días' },
    hours: { de: 'Std', en: 'Hrs', es: 'Hrs' },
    minutes: { de: 'Min', en: 'Min', es: 'Min' },
    seconds: { de: 'Sek', en: 'Sec', es: 'Seg' },
  },
  hotels: { de: 'Übernachtung', en: 'Where to stay', es: 'Alojamiento' },
  website: { de: 'Website', en: 'Website', es: 'Web' },
  route: { de: 'Route planen', en: 'Directions', es: 'Cómo llegar' },
  showMap: { de: 'Karte anzeigen', en: 'Show map', es: 'Mostrar mapa' },
  mapNote: {
    de: 'Lädt Kartenbilder von OpenStreetMap.',
    en: 'Loads map images from OpenStreetMap.',
    es: 'Carga imágenes de OpenStreetMap.',
  },
  mapOf: { de: 'Karte', en: 'Map', es: 'Mapa' },
  largerMap: { de: 'Größere Karte', en: 'Larger map', es: 'Mapa más grande' },
  call: { de: 'Anrufen', en: 'Call', es: 'Llamar' },
  mail: { de: 'E-Mail', en: 'Email', es: 'Correo' },
  whatsapp: { de: 'WhatsApp', en: 'WhatsApp', es: 'WhatsApp' },
  close: { de: 'Schließen', en: 'Close', es: 'Cerrar' },
  musicLink: { de: 'Playlist öffnen', en: 'Open playlist', es: 'Abrir la lista' },
  rsvp: {
    deadline: { de: 'Bitte antwortet bis', en: 'Please reply by', es: 'Responded antes del' },
    yes: { de: 'Ja, wir kommen', en: "Yes, we'll be there", es: 'Sí, iremos' },
    no: { de: 'Leider nicht', en: "Sadly we can't", es: 'Lamentablemente no' },
    you: { de: 'Du', en: 'You', es: 'Tú' },
    name: { de: 'Name', en: 'Name', es: 'Nombre' },
    companion: { de: 'Begleitung', en: 'Companion', es: 'Acompañante' },
    addCompanion: {
      de: '+ Begleitung hinzufügen',
      en: '+ Add companion',
      es: '+ Añadir acompañante',
    },
    addPerson: { de: '+ Weitere Person', en: '+ Add person', es: '+ Añadir persona' },
    remove: { de: 'Entfernen', en: 'Remove', es: 'Quitar' },
    diet: { de: 'Ernährung', en: 'Dietary needs', es: 'Alimentación' },
    vegetarian: { de: 'Vegetarisch', en: 'Vegetarian', es: 'Vegetariano' },
    vegan: { de: 'Vegan', en: 'Vegan', es: 'Vegano' },
    glutenFree: { de: 'Glutenfrei', en: 'Gluten-free', es: 'Sin gluten' },
    lactoseFree: { de: 'Laktosefrei', en: 'Lactose-free', es: 'Sin lactosa' },
    dietNote: {
      de: 'Allergien oder Hinweise (optional)',
      en: 'Allergies or notes (optional)',
      es: 'Alergias u observaciones (opcional)',
    },
    message: {
      de: 'Nachricht an uns (optional)',
      en: 'Message to us (optional)',
      es: 'Mensaje para nosotros (opcional)',
    },
    save: { de: 'Antwort speichern', en: 'Save reply', es: 'Guardar respuesta' },
    back: { de: 'Zurück', en: 'Back', es: 'Atrás' },
    thanksYes: {
      de: 'Danke! Wir freuen uns auf euch.',
      en: "Thank you! We can't wait to see you.",
      es: '¡Gracias! Nos hace mucha ilusión.',
    },
    thanksNo: {
      de: 'Schade – danke für eure Rückmeldung.',
      en: 'Too bad – thanks for letting us know.',
      es: 'Qué pena – gracias por avisarnos.',
    },
    change: { de: 'Antwort ändern', en: 'Change reply', es: 'Cambiar respuesta' },
    who: { de: 'Wer kann nicht kommen?', en: "Who can't come?", es: '¿Quién no puede venir?' },
  },
} as const satisfies Record<string, UiText | Record<string, UiText>>;
