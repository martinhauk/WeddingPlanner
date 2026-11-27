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
  /** The hero's line when this browser has a reply (from the `wp_rsvp_state` cookie). */
  rsvpSaidYes: { de: 'Ihr habt zugesagt.', en: 'You said yes.', es: 'Habéis dicho que sí.' },
  rsvpSaidNo: { de: 'Ihr habt abgesagt.', en: 'You said no.', es: 'Habéis dicho que no.' },
  /** The navigation's RSVP entry when this browser has a reply: short, it may sit in one line. */
  navSaidYes: { de: 'Zugesagt', en: 'You said yes', es: 'Dijisteis que sí' },
  navSaidNo: { de: 'Abgesagt', en: 'You said no', es: 'Dijisteis que no' },
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
  /** Under the map button; `{link}` becomes the link to the privacy notice (`mapPrivacyLink`). */
  mapNote: {
    de: 'Die Karte lädt Bilder von Servern der OpenStreetMap Foundation (Vereinigtes Königreich), die dabei eure IP-Adresse erhalten. Mehr in der {link}.',
    en: 'The map loads images from servers of the OpenStreetMap Foundation (United Kingdom), which receive your IP address. More in our {link}.',
    es: 'El mapa carga imágenes de servidores de la OpenStreetMap Foundation (Reino Unido), que reciben vuestra dirección IP. Más información en nuestra {link}.',
  },
  mapPrivacyLink: {
    de: 'Datenschutzerklärung',
    en: 'privacy notice',
    es: 'política de privacidad',
  },
  mapOf: { de: 'Karte', en: 'Map', es: 'Mapa' },
  largerMap: { de: 'Größere Karte', en: 'Larger map', es: 'Mapa más grande' },
  call: { de: 'Anrufen', en: 'Call', es: 'Llamar' },
  mail: { de: 'E-Mail', en: 'Email', es: 'Correo' },
  whatsapp: { de: 'WhatsApp', en: 'WhatsApp', es: 'WhatsApp' },
  close: { de: 'Schließen', en: 'Close', es: 'Cerrar' },
  musicLink: { de: 'Playlist öffnen', en: 'Open playlist', es: 'Abrir la lista' },
  /** Footer link to the privacy notice. */
  privacy: { de: 'Datenschutz', en: 'Privacy', es: 'Privacidad' },
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
    /** The hero's and the navigation's link to the own reply after the deadline (read-only). */
    viewReply: { de: 'Antwort ansehen', en: 'View your reply', es: 'Ver vuestra respuesta' },
    who: { de: 'Wer kann nicht kommen?', en: "Who can't come?", es: '¿Quién no puede venir?' },
    person: { de: 'Person', en: 'Person', es: 'Persona' },
    attendance: { de: 'Eure Antwort', en: 'Your reply', es: 'Vuestra respuesta' },
    opensSoon: {
      de: 'Die Anmeldung öffnet bald – schaut gern wieder vorbei.',
      en: 'RSVP opens soon – please check back.',
      es: 'La confirmación abrirá pronto – volved a pasar más adelante.',
    },
    deadlinePassed: {
      de: 'Die Antwortfrist endete am',
      en: 'Replies closed on',
      es: 'El plazo de respuesta terminó el',
    },
    answeredYes: {
      de: 'Ihr habt bereits zugesagt.',
      en: "You've already said yes.",
      es: 'Ya habéis confirmado vuestra asistencia.',
    },
    answeredNo: {
      de: 'Ihr habt bereits abgesagt.',
      en: "You've already told us you can't come.",
      es: 'Ya nos habéis dicho que no podéis venir.',
    },
    showReply: { de: 'Antwort anzeigen', en: 'Show reply', es: 'Ver respuesta' },
    loading: {
      de: 'Eure Antwort wird geladen …',
      en: 'Loading your reply …',
      es: 'Cargando vuestra respuesta …',
    },
    saving: { de: 'Wird gespeichert …', en: 'Saving …', es: 'Guardando …' },
    coming: { de: 'Dabei sind', en: 'Coming', es: 'Vienen' },
    notComing: { de: 'Nicht dabei', en: 'Not coming', es: 'No vienen' },
    yourMessage: { de: 'Eure Nachricht', en: 'Your message', es: 'Vuestro mensaje' },
    withdraw: { de: 'Antwort zurückziehen', en: 'Withdraw reply', es: 'Retirar respuesta' },
    withdrawConfirm: {
      de: 'Wollt ihr eure Antwort wirklich zurückziehen?',
      en: 'Do you really want to withdraw your reply?',
      es: '¿Seguro que queréis retirar vuestra respuesta?',
    },
    withdrawYes: { de: 'Ja, zurückziehen', en: 'Yes, withdraw', es: 'Sí, retirar' },
    cancel: { de: 'Abbrechen', en: 'Cancel', es: 'Cancelar' },
    withdrawn: {
      de: 'Eure Antwort wurde zurückgezogen.',
      en: 'Your reply has been withdrawn.',
      es: 'Vuestra respuesta se ha retirado.',
    },
    readOnly: {
      de: 'Die Antwortfrist ist vorbei. Für Änderungen meldet euch bitte direkt bei uns.',
      en: 'The reply period is over. For changes, please contact us directly.',
      es: 'El plazo de respuesta ha terminado. Para cambios, contactad directamente con nosotros.',
    },
    retry: { de: 'Erneut versuchen', en: 'Try again', es: 'Reintentar' },
    alreadyAnswered: {
      de: 'Aus diesem Browser gibt es schon eine Antwort – hier ist sie.',
      en: 'This browser has already sent a reply – here it is.',
      es: 'Desde este navegador ya se envió una respuesta – aquí está.',
    },
    conflict: {
      de: 'Eure Antwort wurde inzwischen an anderer Stelle geändert. Hier ist der aktuelle Stand.',
      en: 'Your reply was changed elsewhere in the meantime. Here is the current version.',
      es: 'Vuestra respuesta se cambió mientras tanto desde otro lugar. Aquí está la versión actual.',
    },
    replyGone: {
      de: 'Eure gespeicherte Antwort wurde nicht gefunden. Bitte sendet sie noch einmal.',
      en: "We couldn't find your saved reply. Please send it again.",
      es: 'No encontramos vuestra respuesta guardada. Por favor, enviadla de nuevo.',
    },
    editLinkTitle: {
      de: 'Euer persönlicher Link',
      en: 'Your personal link',
      es: 'Vuestro enlace personal',
    },
    editLinkHint: {
      de: 'Hebt diesen Link gut auf: Damit könnt ihr eure Antwort auf jedem Handy und in jedem Browser ansehen und ändern. Teilt ihn nicht mit anderen.',
      en: "Keep this link safe: with it you can see and change your reply on any phone or browser. Please don't share it.",
      es: 'Guardad bien este enlace: con él podéis ver y cambiar vuestra respuesta desde cualquier móvil o navegador. No lo compartáis.',
    },
    showLink: {
      de: 'Euren persönlichen Link anzeigen',
      en: 'Show your personal link',
      es: 'Ver vuestro enlace personal',
    },
    copyLink: { de: 'Link kopieren', en: 'Copy link', es: 'Copiar enlace' },
    linkCopied: { de: 'Link kopiert.', en: 'Link copied.', es: 'Enlace copiado.' },
    copyFailed: {
      de: 'Kopieren hat nicht geklappt – bitte markiert den Link und kopiert ihn selbst.',
      en: "Couldn't copy – please select the link and copy it yourself.",
      es: 'No se pudo copiar – seleccionad el enlace y copiadlo vosotros.',
    },
    claiming: {
      de: 'Eure Antwort wird über euren persönlichen Link geöffnet …',
      en: 'Opening your reply from your personal link …',
      es: 'Abriendo vuestra respuesta desde vuestro enlace personal …',
    },
    claimed: {
      de: 'Eure Antwort ist jetzt auch in diesem Browser gespeichert. Ihr könnt sie hier ändern.',
      en: 'Your reply is now saved in this browser too. You can change it here.',
      es: 'Vuestra respuesta ahora también está guardada en este navegador. Podéis cambiarla aquí.',
    },
    /**
     * The page has a reply and the opened link belongs to another one. Plain words only (no
     * browser, link or saving): `{own}` and `{link}` are the names of the two replies.
     */
    whoTitle: { de: 'Wer seid ihr?', en: 'Who are you?', es: '¿Quiénes sois?' },
    whoQuestion: {
      de: 'Seid ihr {own} oder {link}?',
      en: 'Are you {own} or {link}?',
      es: '¿Sois {own} o {link}?',
    },
    linkInvalid: {
      de: 'Dieser Link funktioniert leider nicht. Vielleicht ist er unvollständig, oder die Antwort dazu wurde zurückgezogen.',
      en: "Sorry, this link doesn't work. It may be incomplete, or its reply was withdrawn.",
      es: 'Lo sentimos, este enlace no funciona. Puede que esté incompleto o que su respuesta se haya retirado.',
    },
    contactHint: {
      de: 'Ihr könnt uns auch direkt Bescheid geben',
      en: 'You can also let us know directly',
      es: 'También podéis avisarnos directamente',
    },
    dietConsent: {
      de: 'Ich bin einverstanden, dass ihr die Angaben zu Ernährung, Allergien und Unverträglichkeiten – auch für die Personen, für die ich antworte und die damit einverstanden sind – speichert und nur für die Planung des Essens verwendet. Ich kann das jederzeit widerrufen.',
      en: "I agree that you store the details about diet, allergies and intolerances – also for the people I'm replying for, with their agreement – and use them only to plan the food. I can withdraw this at any time.",
      es: 'Acepto que guardéis los datos sobre alimentación, alergias e intolerancias – también de las personas por las que respondo, con su permiso – y que los uséis solo para planificar la comida. Puedo retirar este consentimiento en cualquier momento.',
    },
    /** `{link}` becomes the link to the privacy notice (`privacyLink`). */
    privacyNote: {
      de: 'Eure Angaben verwenden wir nur für die Organisation unserer Hochzeit. Mehr dazu in der {link}.',
      en: 'We only use your details to organise our wedding. More in our {link}.',
      es: 'Solo usamos vuestros datos para organizar nuestra boda. Más información en nuestra {link}.',
    },
    privacyLink: {
      de: 'Datenschutzerklärung',
      en: 'privacy notice',
      es: 'política de privacidad',
    },
  },
  rsvpError: {
    nameRequired: {
      de: 'Bitte gebt einen Namen ein.',
      en: 'Please enter a name.',
      es: 'Por favor, escribid un nombre.',
    },
    nameTooShort: {
      de: 'Bitte gebt den vollständigen Namen ein.',
      en: 'Please enter the full name.',
      es: 'Por favor, escribid el nombre completo.',
    },
    nameInvalid: {
      de: 'Bitte gebt nur einen Namen ein, ohne Links oder E-Mail-Adressen.',
      en: 'Please enter just a name, without links or email addresses.',
      es: 'Por favor, escribid solo un nombre, sin enlaces ni direcciones de correo.',
    },
    nameDuplicate: {
      de: 'Dieser Name steht schon in eurer Antwort.',
      en: 'This name is already in your reply.',
      es: 'Este nombre ya está en vuestra respuesta.',
    },
    consentRequired: {
      de: 'Bitte willigt ein oder entfernt die Angaben zur Ernährung.',
      en: 'Please give your consent or remove the dietary details.',
      es: 'Por favor, dad vuestro consentimiento o quitad los datos de alimentación.',
    },
    tooLong: {
      de: 'Dieser Text ist zu lang.',
      en: 'This text is too long.',
      es: 'Este texto es demasiado largo.',
    },
    checkFields: {
      de: 'Bitte prüft die markierten Angaben.',
      en: 'Please check the highlighted fields.',
      es: 'Por favor, revisad los campos marcados.',
    },
    validation: {
      de: 'Die Antwort konnte nicht gespeichert werden. Bitte prüft eure Angaben.',
      en: "Your reply couldn't be saved. Please check your entries.",
      es: 'No se pudo guardar la respuesta. Por favor, revisad los datos.',
    },
    rejected: {
      de: 'Die Antwort konnte nicht gesendet werden. Bitte prüft eure Angaben und versucht es gleich noch einmal.',
      en: "Your reply couldn't be sent. Please check your entries and try again in a moment.",
      es: 'No se pudo enviar la respuesta. Por favor, revisad los datos y volved a intentarlo en un momento.',
    },
    closed: {
      de: 'Die Antwortfrist ist abgelaufen.',
      en: 'The reply period has ended.',
      es: 'El plazo de respuesta ha terminado.',
    },
    rateLimited: {
      de: 'Zu viele Versuche in kurzer Zeit. Bitte wartet ein paar Minuten und versucht es dann erneut.',
      en: 'Too many attempts in a short time. Please wait a few minutes and try again.',
      es: 'Demasiados intentos en poco tiempo. Esperad unos minutos y volved a intentarlo.',
    },
    network: {
      de: 'Keine Verbindung. Bitte prüft eure Internetverbindung und versucht es erneut.',
      en: 'No connection. Please check your internet connection and try again.',
      es: 'Sin conexión. Comprobad vuestra conexión a internet y volved a intentarlo.',
    },
    full: {
      de: 'Online können wir leider keine weiteren Antworten annehmen.',
      en: "Sorry, we can't accept any more replies online.",
      es: 'Lo sentimos, ya no podemos aceptar más respuestas en línea.',
    },
    unavailable: {
      de: 'Das hat leider nicht geklappt. Bitte versucht es später noch einmal.',
      en: "Sorry, that didn't work. Please try again later.",
      es: 'Lo sentimos, no ha funcionado. Volved a intentarlo más tarde.',
    },
  },
} as const satisfies Record<string, UiText | Record<string, UiText>>;
