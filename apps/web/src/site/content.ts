// Fictional sample content (public repo!). Real content comes from the private instance repo later.
export type Lang = 'de' | 'en' | 'es';
export type L = Record<Lang, string>;
export const LANGS: Lang[] = ['de', 'en', 'es'];

export type Location = {
  id: string;
  name: string;
  kind: L;
  address: string;
  lat: number;
  lng: number;
  note?: L;
};

export const content = {
  couple: 'Anna & Ben',
  date: '2027-06-19T14:00:00+02:00',
  heroImage: '',
  tagline: { de: 'Wir heiraten', en: "We're getting married", es: 'Nos casamos' },
  place: { de: 'Hamburg, Deutschland', en: 'Hamburg, Germany', es: 'Hamburgo, Alemania' },
  rsvpDeadline: '2027-01-15',
  story: {
    de: 'Kennengelernt haben wir uns auf einer Zugfahrt, die drei Stunden Verspätung hatte. Seitdem reisen wir zusammen – und jetzt wollen wir mit euch feiern, dass aus der Verspätung ein „für immer“ geworden ist.',
    en: 'We met on a train that was three hours late. We have been travelling together ever since – and now we want to celebrate with you that the delay turned into a “forever”.',
    es: 'Nos conocimos en un tren que llevaba tres horas de retraso. Desde entonces viajamos juntos – y ahora queremos celebrar con vosotros que aquel retraso se convirtió en un “para siempre”.',
  } satisfies L,
  schedule: [
    { time: '14:00', title: { de: 'Trauung', en: 'Ceremony', es: 'Ceremonia' }, where: 'church' },
    { time: '15:30', title: { de: 'Sektempfang', en: 'Champagne reception', es: 'Recepción' }, where: 'venue' },
    { time: '18:30', title: { de: 'Abendessen', en: 'Dinner', es: 'Cena' }, where: 'venue' },
    { time: '21:00', title: { de: 'Party', en: 'Party', es: 'Fiesta' }, where: 'venue' },
  ],
  locations: [
    {
      id: 'church',
      name: 'St. Beispiel Kirche',
      kind: { de: 'Trauung', en: 'Ceremony', es: 'Ceremonia' },
      address: 'Beispielstraße 1, 20095 Hamburg',
      lat: 53.5503,
      lng: 9.9937,
    },
    {
      id: 'venue',
      name: 'Gut Musterhof',
      kind: { de: 'Feier', en: 'Celebration', es: 'Celebración' },
      address: 'Musterweg 5, 22587 Hamburg',
      lat: 53.5585,
      lng: 9.7735,
      note: { de: 'Parkplätze vor Ort.', en: 'Parking on site.', es: 'Aparcamiento en el lugar.' },
    },
  ] satisfies Location[],
  hotels: [
    { name: 'Hotel Elbblick', address: 'Elbchaussee 10, 22763 Hamburg', url: 'https://example.com' },
    { name: 'Pension Am Park', address: 'Parkallee 3, 20144 Hamburg', url: 'https://example.com' },
  ],
  dresscode: {
    de: 'Sommerlich elegant. Die Feier ist teilweise draußen auf Rasen – denkt an bequeme Schuhe.',
    en: 'Summer elegant. Part of the party is outside on grass – think comfortable shoes.',
    es: 'Elegante de verano. Parte de la fiesta es al aire libre sobre césped – zapatos cómodos.',
  } satisfies L,
  gifts: {
    de: 'Das größte Geschenk ist, dass ihr dabei seid. Wer uns darüber hinaus etwas schenken möchte: sprecht uns gerne an.',
    en: 'Having you with us is the greatest gift. If you would like to give us something beyond that, just ask us.',
    es: 'El mejor regalo es que estéis con nosotros. Si queréis regalarnos algo más, preguntadnos.',
  } satisfies L,
  faq: [
    {
      q: { de: 'Dürfen Kinder mitkommen?', en: 'Can we bring children?', es: '¿Podemos traer niños?' },
      a: {
        de: 'Wir feiern diesen Tag nur mit Erwachsenen.',
        en: 'We are celebrating this day with adults only.',
        es: 'Celebraremos este día solo con adultos.',
      },
    },
    {
      q: { de: 'Gibt es Parkplätze?', en: 'Is there parking?', es: '¿Hay aparcamiento?' },
      a: { de: 'Ja, direkt an der Location.', en: 'Yes, right at the venue.', es: 'Sí, junto al lugar.' },
    },
    {
      q: { de: 'Bis wann sollen wir zusagen?', en: 'When should we reply?', es: '¿Hasta cuándo confirmamos?' },
      a: {
        de: 'Bitte bis 15. Januar 2027.',
        en: 'Please by 15 January 2027.',
        es: 'Por favor, antes del 15 de enero de 2027.',
      },
    },
  ],
  contacts: [
    { name: 'Anna', phone: '+49 151 00000000', email: 'anna@example.com' },
    { name: 'Ben', phone: '+49 151 11111111', email: 'ben@example.com' },
  ],
};

export const ui = {
  nav: {
    story: { de: 'Unsere Geschichte', en: 'Our story', es: 'Nuestra historia' },
    schedule: { de: 'Ablauf', en: 'Schedule', es: 'Programa' },
    locations: { de: 'Anreise', en: 'Travel', es: 'Cómo llegar' },
    dresscode: { de: 'Dresscode', en: 'Dress code', es: 'Vestimenta' },
    faq: { de: 'Fragen', en: 'FAQ', es: 'Preguntas' },
    gifts: { de: 'Geschenke', en: 'Gifts', es: 'Regalos' },
    contact: { de: 'Kontakt', en: 'Contact', es: 'Contacto' },
    rsvp: { de: 'Zusagen', en: 'RSVP', es: 'Confirmar' },
  },
  countdown: { de: ['Tage', 'Std', 'Min', 'Sek'], en: ['Days', 'Hrs', 'Min', 'Sec'], es: ['Días', 'Hrs', 'Min', 'Seg'] },
  hotels: { de: 'Übernachtung', en: 'Where to stay', es: 'Alojamiento' },
  route: { de: 'Route planen', en: 'Directions', es: 'Cómo llegar' },
  showMap: { de: 'Karte anzeigen', en: 'Show map', es: 'Mostrar mapa' },
  mapNote: {
    de: 'Lädt Kartendaten von OpenStreetMap.',
    en: 'Loads map data from OpenStreetMap.',
    es: 'Carga datos de OpenStreetMap.',
  },
  call: { de: 'Anrufen', en: 'Call', es: 'Llamar' },
  mail: { de: 'E-Mail', en: 'Email', es: 'Correo' },
  rsvp: {
    title: { de: 'Seid ihr dabei?', en: 'Will you join us?', es: '¿Vendréis?' },
    deadline: { de: 'Bitte antwortet bis', en: 'Please reply by', es: 'Responded antes del' },
    yes: { de: 'Ja, wir kommen', en: "Yes, we'll be there", es: 'Sí, iremos' },
    no: { de: 'Leider nicht', en: "Sadly we can't", es: 'Lamentablemente no' },
    name: { de: 'Dein Name', en: 'Your name', es: 'Tu nombre' },
    companion: { de: 'Begleitung', en: 'Companion', es: 'Acompañante' },
    addCompanion: { de: '+ Begleitung hinzufügen', en: '+ Add companion', es: '+ Añadir acompañante' },
    remove: { de: 'Entfernen', en: 'Remove', es: 'Quitar' },
    diet: { de: 'Ernährung / Allergien', en: 'Dietary needs / allergies', es: 'Dieta / alergias' },
    message: { de: 'Nachricht an uns (optional)', en: 'Message to us (optional)', es: 'Mensaje (opcional)' },
    save: { de: 'Antwort speichern', en: 'Save reply', es: 'Guardar respuesta' },
    back: { de: 'Zurück', en: 'Back', es: 'Atrás' },
    thanksYes: { de: 'Danke! Wir freuen uns auf euch.', en: "Thank you! We can't wait to see you.", es: '¡Gracias! Nos hace mucha ilusión.' },
    thanksNo: { de: 'Schade – danke für eure Rückmeldung.', en: 'Too bad – thanks for letting us know.', es: 'Qué pena – gracias por avisarnos.' },
    change: { de: 'Antwort ändern', en: 'Change reply', es: 'Cambiar respuesta' },
    who: { de: 'Wer sagt ab?', en: "Who can't come?", es: '¿Quién no puede venir?' },
  },
};
