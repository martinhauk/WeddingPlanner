import type { UiText } from '../ui.ts';

/**
 * The built-in privacy notice (German law: GDPR, TDDDG, DDG), complete in every site language. The
 * instance adds the controllers, the contact email, the deletion date and optional paragraphs
 * (`site-content.json` `privacy`). Placeholders in braces are filled by the page: `{controllers}`,
 * `{email}`, `{deleteBy}`, `{appRegion}`, `{dataRegion}`, `{showMap}`.
 *
 * Keep it true to the code: when the app starts storing, logging or loading something new, change
 * this text and `docs/privacy/data-inventory.md` in the same commit.
 */
export const privacyText = {
  title: { de: 'Datenschutzerklärung', en: 'Privacy notice', es: 'Política de privacidad' },
  back: {
    de: 'Zurück zur Einladung',
    en: 'Back to the invitation',
    es: 'Volver a la invitación',
  },
  intro: {
    de: 'Diese Website ist die private Einladung zu unserer Hochzeit. Wir erheben nur die Daten, die wir für die Organisation der Feier brauchen, und verwenden sie für nichts anderes.',
    en: 'This website is the private invitation to our wedding. We only collect the data we need to organise the celebration and use it for nothing else.',
    es: 'Esta web es la invitación privada a nuestra boda. Solo recogemos los datos que necesitamos para organizar la celebración y no los usamos para nada más.',
  },

  controllerTitle: { de: 'Verantwortlich', en: 'Who is responsible', es: 'Responsables' },
  controllerOne: {
    de: 'Verantwortlich für die Verarbeitung eurer Daten im Sinne der Datenschutz-Grundverordnung (DSGVO) ist {controllers}.',
    en: 'The controller of your data under the General Data Protection Regulation (GDPR) is {controllers}.',
    es: 'La persona responsable del tratamiento de vuestros datos según el Reglamento General de Protección de Datos (RGPD) es {controllers}.',
  },
  controllerMany: {
    de: 'Verantwortlich für die Verarbeitung eurer Daten im Sinne der Datenschutz-Grundverordnung (DSGVO) sind {controllers}.',
    en: 'The controllers of your data under the General Data Protection Regulation (GDPR) are {controllers}.',
    es: 'Los responsables del tratamiento de vuestros datos según el Reglamento General de Protección de Datos (RGPD) son {controllers}.',
  },
  contactEmail: {
    de: 'Kontakt für alle Fragen zum Datenschutz: {email}',
    en: 'Contact for all privacy questions: {email}',
    es: 'Contacto para cualquier cuestión de privacidad: {email}',
  },
  contactFallback: {
    de: 'Bei Fragen zum Datenschutz erreicht ihr uns über die Kontaktangaben auf dieser Website.',
    en: 'For privacy questions, reach us through the contact details on this website.',
    es: 'Para cuestiones de privacidad, podéis contactarnos a través de los datos de contacto de esta web.',
  },

  dataTitle: {
    de: 'Welche Daten wir verarbeiten',
    en: 'What data we process',
    es: 'Qué datos tratamos',
  },
  dataRsvp: {
    de: 'Wenn ihr auf die Einladung antwortet: die Namen der Personen, für die ihr antwortet, ob ihr kommt, freiwillige Angaben zur Ernährung (vegetarisch, vegan, glutenfrei, laktosefrei) und zu Allergien oder Unverträglichkeiten, eure optionale Nachricht an uns, die gewählte Sprache und den Zeitpunkt der Antwort. Die Antwort ist freiwillig; ohne Namen können wir sie aber nicht zuordnen.',
    en: 'When you reply to the invitation: the names of the people you reply for, whether you are coming, voluntary details about your diet (vegetarian, vegan, gluten-free, lactose-free) and about allergies or intolerances, your optional message to us, the language you chose and when you replied. Replying is voluntary, but without names we cannot match your reply.',
    es: 'Cuando respondéis a la invitación: los nombres de las personas por las que respondéis, si venís, datos voluntarios sobre alimentación (vegetariana, vegana, sin gluten, sin lactosa) y sobre alergias o intolerancias, vuestro mensaje opcional, el idioma elegido y la fecha de la respuesta. Responder es voluntario, pero sin nombres no podemos asignar la respuesta.',
  },
  dataHealth: {
    de: 'Angaben zu Allergien und Unverträglichkeiten können Gesundheitsdaten sein (Art. 9 DSGVO). Angaben zur Ernährung speichern wir deshalb nur mit eurer ausdrücklichen Einwilligung und nur für Personen, die kommen. Im Antwortformular willigt ihr selbst ein. Gebt ihr uns solche Angaben auf anderem Weg, zum Beispiel per E-Mail, tragen wir sie nur ein, wenn ihr ausdrücklich zugestimmt habt. Wir halten fest, dass und wann eingewilligt wurde und ob im Formular oder direkt bei uns. Bei einer Absage speichern wir keine Angaben zur Ernährung.',
    en: 'Allergies and intolerances can be health data (Art. 9 GDPR). We therefore only store dietary details with your explicit consent, and only for people who are coming. In the reply form, you give your consent yourselves. If you give us such details another way, for example by email, we only enter them if you have explicitly agreed. We record that consent was given, when, and whether in the form or directly to us. If you decline, we store no dietary details.',
    es: 'Las alergias e intolerancias pueden ser datos de salud (art. 9 RGPD). Por eso solo guardamos datos sobre alimentación con vuestro consentimiento expreso, y solo de las personas que vienen. En el formulario lo dais vosotros mismos. Si nos dais esos datos por otra vía, por ejemplo por correo electrónico, solo los introducimos si lo habéis consentido expresamente. Dejamos constancia de que se dio el consentimiento, de cuándo y de si fue en el formulario o directamente a nosotros. Si no venís, no guardamos ningún dato sobre alimentación.',
  },
  editLink: {
    de: 'Nach dem Absenden bekommt ihr einen persönlichen Link zu eurer Antwort. Später könnt ihr ihn euch auf der Einladungsseite bei eurer Antwort noch einmal anzeigen lassen, in dem Browser, mit dem ihr geantwortet oder den Link geöffnet habt. Wer den Link hat, kann eure Antwort ansehen, ändern und zurückziehen. Behaltet ihn deshalb für euch. Er funktioniert, solange es eure Antwort gibt.',
    en: 'After sending your reply, you get a personal link to it. You can show it again later in the reply section of the invitation page, in the browser you used to reply or to open the link. Anyone who has the link can see, change and withdraw your reply, so please keep it to yourselves. It works for as long as your reply exists.',
    es: 'Después de enviar la respuesta recibís un enlace personal a ella. Más tarde podéis volver a mostrarlo junto a vuestra respuesta en la página de la invitación, desde el navegador con el que respondisteis o abristeis el enlace. Quien tenga el enlace puede ver, cambiar y retirar vuestra respuesta, así que no lo compartáis con nadie. Funciona mientras exista vuestra respuesta.',
  },
  editLinkSecret: {
    de: 'Der Link enthält einen zufälligen geheimen Schlüssel. Wir speichern davon nur eine Art Fingerabdruck (einen sogenannten Hash), aus dem sich der Link nicht zurückgewinnen lässt, nie den Link selbst. Der Schlüssel steht im Teil der Adresse nach dem „#“. Diesen Teil schicken Browser beim Öffnen nicht an den Server, er landet also nicht in Server-Protokollen. Nur die Seite selbst liest ihn und schickt ihn verschlüsselt an unsere Schnittstelle, um eure Antwort zu öffnen.',
    en: 'The link contains a random secret key. We only store a kind of fingerprint of it (a so-called hash) from which the link cannot be recovered, never the link itself. The key is in the part of the address after the “#”. Browsers do not send this part to the server when they open the page, so it does not end up in server logs. Only the page itself reads it and sends it, encrypted, to our interface to open your reply.',
    es: 'El enlace contiene una clave secreta aleatoria. Solo guardamos una especie de huella de ella (lo que se llama un hash), a partir de la cual no se puede recuperar el enlace, y nunca el enlace en sí. La clave va en la parte de la dirección que sigue a «#». Los navegadores no envían esa parte al servidor al abrir la página, así que no queda en los registros del servidor. Solo la propia página la lee y la envía cifrada a nuestra interfaz para abrir vuestra respuesta.',
  },
  dataTechnical: {
    de: 'Beim Aufruf der Website verarbeitet unser Hosting-Anbieter technisch notwendige Verbindungsdaten wie eure IP-Adresse, um die Seiten auszuliefern und vor Missbrauch zu schützen. Unsere Anwendung zählt Anfragen zum Schutz vor Missbrauch kurzzeitig im Arbeitsspeicher und speichert keine IP-Adressen.',
    en: 'When you open the website, our hosting provider processes technically necessary connection data such as your IP address to deliver the pages and to protect them against abuse. To prevent abuse, our application briefly counts requests in memory; it does not store IP addresses.',
    es: 'Al abrir la web, nuestro proveedor de alojamiento trata datos de conexión técnicamente necesarios, como vuestra dirección IP, para servir las páginas y protegerlas frente a abusos. Para evitar abusos, nuestra aplicación cuenta las solicitudes brevemente en memoria; no guarda direcciones IP.',
  },

  purposeTitle: {
    de: 'Wofür wir die Daten verwenden',
    en: 'Why we use the data',
    es: 'Para qué usamos los datos',
  },
  purpose: {
    de: 'Ausschließlich für die Organisation unserer Hochzeit: für die Gästeliste, die Planung von Essen und Ablauf und, wenn ihr uns schreibt, für unsere Antwort. Angaben zur Ernährung geben wir nur an die Küche bzw. das Catering der Feier weiter, soweit sie dort für die Zubereitung gebraucht werden. Eine automatisierte Entscheidungsfindung oder ein Profiling findet nicht statt.',
    en: 'Only to organise our wedding: for the guest list, planning the food and the day and, if you write to us, for our answer. We only pass dietary details on to the kitchen or caterer of the celebration where they need them to prepare the food. There is no automated decision-making or profiling.',
    es: 'Exclusivamente para organizar nuestra boda: para la lista de invitados, la planificación de la comida y del día y, si nos escribís, para contestaros. Solo pasamos los datos de alimentación a la cocina o al catering de la celebración, en la medida en que los necesiten para preparar la comida. No hay decisiones automatizadas ni elaboración de perfiles.',
  },

  legalTitle: { de: 'Rechtsgrundlagen', en: 'Legal bases', es: 'Bases jurídicas' },
  legal: [
    {
      de: 'Eure Antwort: eure Einwilligung durch das freiwillige Absenden (Art. 6 Abs. 1 lit. a DSGVO) und die Durchführung eurer Anmeldung zu unserer Feier (Art. 6 Abs. 1 lit. b DSGVO).',
      en: 'Your reply: your consent by sending it voluntarily (Art. 6(1)(a) GDPR) and handling your registration for our celebration (Art. 6(1)(b) GDPR).',
      es: 'Vuestra respuesta: vuestro consentimiento al enviarla voluntariamente (art. 6.1.a RGPD) y la gestión de vuestra inscripción en nuestra celebración (art. 6.1.b RGPD).',
    },
    {
      de: 'Angaben zu Ernährung, Allergien und Unverträglichkeiten: eure ausdrückliche Einwilligung (Art. 9 Abs. 2 lit. a DSGVO).',
      en: 'Details about diet, allergies and intolerances: your explicit consent (Art. 9(2)(a) GDPR).',
      es: 'Datos sobre alimentación, alergias e intolerancias: vuestro consentimiento expreso (art. 9.2.a RGPD).',
    },
    {
      de: 'Auslieferung und Schutz der Website: unser berechtigtes Interesse an einem sicheren Betrieb (Art. 6 Abs. 1 lit. f DSGVO).',
      en: 'Delivering and protecting the website: our legitimate interest in running it securely (Art. 6(1)(f) GDPR).',
      es: 'Servir y proteger la web: nuestro interés legítimo en un funcionamiento seguro (art. 6.1.f RGPD).',
    },
    {
      de: 'Cookies und lokaler Speicher: § 25 Abs. 2 Nr. 2 TDDDG (unbedingt erforderlich für die Funktion, die ihr nutzt).',
      en: 'Cookies and local storage: Section 25(2) no. 2 TDDDG (strictly necessary for the function you use).',
      es: 'Cookies y almacenamiento local: § 25.2, n.º 2 TDDDG (estrictamente necesarios para la función que utilizáis).',
    },
  ],

  hostingTitle: {
    de: 'Hosting und Dienstleister',
    en: 'Hosting and service providers',
    es: 'Alojamiento y proveedores',
  },
  hosting: {
    de: 'Website und Antwortformular laufen auf Microsoft Azure. Anbieter ist die Microsoft Ireland Operations Limited (Dublin, Irland), die als Auftragsverarbeiter nach unserer Weisung handelt (Art. 28 DSGVO). Die Seiten liefert Microsoft über ein weltweites Netz von Servern aus. Die Schnittstelle, die eure Antworten entgegennimmt, läuft in der Azure-Region {appRegion}. Gespeichert werden eure Antworten in der Region {dataRegion}; dort liegen auch die Sicherungskopien und die technischen Protokolle.',
    en: 'The website and the reply form run on Microsoft Azure. The provider is Microsoft Ireland Operations Limited (Dublin, Ireland), which acts as a processor on our instructions (Art. 28 GDPR). Microsoft delivers the pages through a worldwide network of servers. The interface that receives your replies runs in the Azure region {appRegion}. Your replies are stored in the region {dataRegion}, where the backups and the technical logs are kept as well.',
    es: 'La web y el formulario de respuesta funcionan en Microsoft Azure. El proveedor es Microsoft Ireland Operations Limited (Dublín, Irlanda), que actúa como encargado del tratamiento siguiendo nuestras instrucciones (art. 28 RGPD). Microsoft sirve las páginas a través de una red mundial de servidores. La interfaz que recibe vuestras respuestas funciona en la región de Azure {appRegion}. Vuestras respuestas se guardan en la región {dataRegion}, donde también están las copias de seguridad y los registros técnicos.',
  },
  // The transfer paragraph is always shown: Microsoft's worldwide network delivers the pages also
  // from outside the EU, whatever the two regions are. The region sentence is added when the app
  // or data region itself is outside the EU (`{regions}`: their names, as a list).
  transfer: {
    de: 'Zum weltweiten Netz von Microsoft gehören auch Server außerhalb der EU, zum Beispiel in den USA. Eure Angaben können deshalb auch dorthin übermittelt werden.',
    en: 'Microsoft’s worldwide network also includes servers outside the EU, for example in the USA, so your details may be transferred there as well.',
    es: 'La red mundial de Microsoft incluye también servidores fuera de la UE, por ejemplo en EE. UU., así que vuestros datos también pueden transferirse allí.',
  },
  transferRegionOne: {
    de: 'Die Azure-Region {regions} liegt ebenfalls außerhalb der EU; dorthin werden eure Antworten in jedem Fall übermittelt.',
    en: 'The Azure region {regions} is also outside the EU, and your replies are always sent there.',
    es: 'La región de Azure {regions} también está fuera de la UE, y vuestras respuestas se envían allí en todo caso.',
  },
  transferRegionMany: {
    de: 'Die Azure-Regionen {regions} liegen ebenfalls außerhalb der EU; dorthin werden eure Antworten in jedem Fall übermittelt.',
    en: 'The Azure regions {regions} are also outside the EU, and your replies are always sent there.',
    es: 'Las regiones de Azure {regions} también están fuera de la UE, y vuestras respuestas se envían allí en todo caso.',
  },
  transferBasis: {
    de: 'Microsoft ist nach dem EU-U.S. Data Privacy Framework zertifiziert, für das ein Angemessenheitsbeschluss der EU-Kommission besteht (Art. 45 DSGVO). Für jede Übermittlung in ein Land außerhalb der EU gelten außerdem die Standardvertragsklauseln der EU-Kommission (Art. 46 DSGVO).',
    en: 'Microsoft is certified under the EU-U.S. Data Privacy Framework, which is covered by an adequacy decision of the European Commission (Art. 45 GDPR). In addition, the European Commission’s standard contractual clauses apply to every transfer to a country outside the EU (Art. 46 GDPR).',
    es: 'Microsoft está certificada conforme al Marco de Privacidad de Datos UE-EE. UU., cubierto por una decisión de adecuación de la Comisión Europea (art. 45 RGPD). Además, para cualquier transferencia a un país fuera de la UE se aplican las cláusulas contractuales tipo de la Comisión Europea (art. 46 RGPD).',
  },
  logs: {
    de: 'Technische Protokolle (Azure Application Insights) helfen uns, Fehler zu finden. Sie enthalten keine Namen, Nachrichten, Angaben zur Ernährung, persönlichen Links, Cookies oder IP-Adressen und werden nach 30 Tagen gelöscht.',
    en: 'Technical logs (Azure Application Insights) help us find errors. They contain no names, messages, dietary details, personal links, cookies or IP addresses, and are deleted after 30 days.',
    es: 'Los registros técnicos (Azure Application Insights) nos ayudan a encontrar errores. No contienen nombres, mensajes, datos de alimentación, enlaces personales, cookies ni direcciones IP, y se borran a los 30 días.',
  },

  mapsTitle: { de: 'Karten und Links', en: 'Maps and links', es: 'Mapas y enlaces' },
  mapsOsm: {
    de: 'Karten von OpenStreetMap laden wir erst, wenn ihr auf „{showMap}“ tippt. Dann ruft euer Browser Kartenbilder von Servern der OpenStreetMap Foundation (Vereinigtes Königreich) ab und übermittelt ihnen dabei eure IP-Adresse. Für das Vereinigte Königreich besteht ein Angemessenheitsbeschluss der EU-Kommission.',
    en: 'We only load maps from OpenStreetMap when you tap “{showMap}”. Your browser then fetches map images from servers of the OpenStreetMap Foundation (United Kingdom) and sends your IP address to them. The United Kingdom is covered by an adequacy decision of the European Commission.',
    es: 'Solo cargamos mapas de OpenStreetMap cuando pulsáis «{showMap}». Entonces vuestro navegador descarga imágenes del mapa de servidores de la OpenStreetMap Foundation (Reino Unido) y les envía vuestra dirección IP. Para el Reino Unido existe una decisión de adecuación de la Comisión Europea.',
  },
  mapsLinks: {
    de: 'Links zu Google Maps, WhatsApp, Playlists oder anderen Websites sind normale Links: Erst wenn ihr einen öffnet, verlasst ihr diese Website, und es gelten die Datenschutzbestimmungen des jeweiligen Anbieters. Vorher werden keine Daten an diese Anbieter übertragen.',
    en: 'Links to Google Maps, WhatsApp, playlists or other websites are ordinary links: only when you open one do you leave this website, and the privacy policy of that provider applies. Until then, no data is sent to these providers.',
    es: 'Los enlaces a Google Maps, WhatsApp, listas de reproducción u otras webs son enlaces normales: solo al abrir uno salís de esta web y se aplica la política de privacidad del proveedor correspondiente. Antes no se envía ningún dato a estos proveedores.',
  },
  noTracking: {
    de: 'Schriftarten und Bilder liefern wir selbst aus. Wir verwenden keine Analyse-, Tracking- oder Werbedienste.',
    en: 'We serve fonts and images ourselves. We use no analytics, tracking or advertising services.',
    es: 'Las fuentes y las imágenes las servimos nosotros mismos. No usamos servicios de analítica, seguimiento ni publicidad.',
  },

  cookiesTitle: {
    de: 'Cookies und lokaler Speicher',
    en: 'Cookies and local storage',
    es: 'Cookies y almacenamiento local',
  },
  cookieRsvp: {
    de: 'erkennt eure Antwort wieder, damit ihr sie ansehen, ändern oder zurückziehen könnt. Er enthält nur zufällige Zeichen (denselben geheimen Schlüssel wie euer persönlicher Link), keinen Namen. Er wird gesetzt, wenn ihr eure Antwort absendet oder euren persönlichen Link öffnet; hat dieser Browser schon eine andere Antwort, fragt die Seite vorher, wer ihr seid. Er gilt ein Jahr und ist für Skripte nicht lesbar.',
    en: 'recognises your reply so you can view, change or withdraw it. It only holds random characters (the same secret key as your personal link), no name. It is set when you send your reply or open your personal link; if this browser already has another reply, the page first asks who you are. It lasts one year and cannot be read by scripts.',
    es: 'reconoce vuestra respuesta para que podáis verla, cambiarla o retirarla. Solo contiene caracteres aleatorios (la misma clave secreta que vuestro enlace personal), ningún nombre. Se crea al enviar la respuesta o al abrir vuestro enlace personal; si este navegador ya tiene otra respuesta, la página os pregunta antes quiénes sois. Dura un año y los scripts no pueden leerla.',
  },
  cookieState: {
    de: 'merkt sich nur „ja“ oder „nein“, damit die Seite zeigen kann, dass ihr schon geantwortet habt. Gilt ein Jahr.',
    en: 'only remembers “yes” or “no”, so the page can show that you have already replied. Lasts one year.',
    es: 'solo recuerda «sí» o «no», para que la página pueda mostrar que ya habéis respondido. Dura un año.',
  },
  storageLang: {
    de: '(lokaler Speicher des Browsers): die Sprache, die ihr gewählt habt.',
    en: '(the browser’s local storage): the language you chose.',
    es: '(almacenamiento local del navegador): el idioma que habéis elegido.',
  },
  cookies: {
    de: 'Diese Speicherungen sind für die Funktionen, die ihr nutzt, unbedingt erforderlich (§ 25 Abs. 2 Nr. 2 TDDDG). Deshalb fragen wir nicht mit einem Cookie-Banner nach. Tracking- oder Werbe-Cookies gibt es nicht. Ihr könnt Cookies und lokalen Speicher jederzeit in eurem Browser löschen. Eure gespeicherte Antwort öffnet ihr danach wieder mit eurem persönlichen Link. Bis zum Ende der Antwortfrist könnt ihr sie selbst ändern, in diesem Browser oder mit eurem persönlichen Link; außer euch (und allen, die euren Link haben) können das nur wir als Gastgeber.',
    en: 'These are strictly necessary for the functions you use (Section 25(2) no. 2 TDDDG), so we don’t ask with a cookie banner. There are no tracking or advertising cookies. You can delete cookies and local storage in your browser at any time. After that, you can open your saved reply again with your personal link. Until replies close, you can change it yourselves, in this browser or with your personal link; apart from you (and anyone who has your link), only we as your hosts can change it.',
    es: 'Son estrictamente necesarios para las funciones que utilizáis (§ 25.2, n.º 2 TDDDG), por eso no os preguntamos con un banner de cookies. No hay cookies de seguimiento ni de publicidad. Podéis borrar las cookies y el almacenamiento local en vuestro navegador en cualquier momento. Después podréis volver a abrir vuestra respuesta guardada con vuestro enlace personal. Hasta que termine el plazo de respuesta podéis cambiarla vosotros mismos, en este navegador o con vuestro enlace personal; aparte de vosotros (y de quien tenga vuestro enlace), solo podemos cambiarla nosotros como anfitriones.',
  },

  retentionTitle: {
    de: 'Wie lange wir Daten speichern',
    en: 'How long we keep data',
    es: 'Cuánto tiempo guardamos los datos',
  },
  retention: {
    de: 'Wir löschen alle Antworten und Gästedaten spätestens am {deleteBy}. Zieht ihr eure Antwort zurück, wird sie sofort gelöscht. Sicherungskopien bewahren wir höchstens 30 Tage auf; gelöschte Daten verschwinden also spätestens 30 Tage später auch dort.',
    en: 'We delete all replies and guest data by {deleteBy} at the latest. If you withdraw your reply, it is deleted immediately. We keep backups for no more than 30 days, so deleted data disappears from them within 30 days as well.',
    es: 'Borramos todas las respuestas y los datos de invitados como muy tarde el {deleteBy}. Si retiráis vuestra respuesta, se borra de inmediato. Guardamos las copias de seguridad como máximo 30 días, así que los datos borrados desaparecen también de ellas en un plazo de 30 días.',
  },

  rightsTitle: { de: 'Eure Rechte', en: 'Your rights', es: 'Vuestros derechos' },
  rights: {
    de: 'Ihr habt das Recht auf Auskunft (Art. 15 DSGVO), Berichtigung (Art. 16), Löschung (Art. 17), Einschränkung der Verarbeitung (Art. 18) und Datenübertragbarkeit (Art. 20) sowie das Recht, einer Verarbeitung aufgrund berechtigter Interessen zu widersprechen (Art. 21).',
    en: 'You have the right of access (Art. 15 GDPR), rectification (Art. 16), erasure (Art. 17), restriction of processing (Art. 18) and data portability (Art. 20), and the right to object to processing based on legitimate interests (Art. 21).',
    es: 'Tenéis derecho de acceso (art. 15 RGPD), rectificación (art. 16), supresión (art. 17), limitación del tratamiento (art. 18) y portabilidad (art. 20), así como derecho a oponeros a un tratamiento basado en intereses legítimos (art. 21).',
  },
  withdraw: {
    de: 'Eine Einwilligung könnt ihr jederzeit mit Wirkung für die Zukunft widerrufen (Art. 7 Abs. 3 DSGVO), zum Beispiel indem ihr eure Antwort ändert oder zurückzieht.',
    en: 'You can withdraw your consent at any time with effect for the future (Art. 7(3) GDPR), for example by changing or withdrawing your reply.',
    es: 'Podéis retirar vuestro consentimiento en cualquier momento con efectos para el futuro (art. 7.3 RGPD), por ejemplo cambiando o retirando vuestra respuesta.',
  },
  rightsEmail: {
    de: 'Für all das genügt eine E-Mail an {email}.',
    en: 'For any of this, just email {email}.',
    es: 'Para cualquiera de ellos basta con escribir a {email}.',
  },
  rightsFallback: {
    de: 'Für all das erreicht ihr uns über die Kontaktangaben auf dieser Website.',
    en: 'For any of this, reach us through the contact details on this website.',
    es: 'Para cualquiera de ellos, podéis contactarnos a través de los datos de contacto de esta web.',
  },
  complaint: {
    de: 'Außerdem könnt ihr euch bei einer Datenschutz-Aufsichtsbehörde beschweren (Art. 77 DSGVO).',
    en: 'You can also lodge a complaint with a data protection supervisory authority (Art. 77 GDPR).',
    es: 'También podéis presentar una reclamación ante una autoridad de control de protección de datos (art. 77 RGPD).',
  },

  imprintTitle: { de: 'Impressum', en: 'Legal notice', es: 'Aviso legal' },
  noImprint: {
    de: 'Diese Website ist ein privates, nicht geschäftsmäßiges Angebot ohne Werbung. Eine Pflicht zur Anbieterkennzeichnung (Impressum) nach § 5 DDG besteht daher nicht.',
    en: 'This is a private, non-commercial website without advertising, so no legal notice (Impressum) under Section 5 DDG is required.',
    es: 'Esta es una web privada, sin fines comerciales ni publicidad, por lo que no es obligatorio un aviso legal (Impressum) según el § 5 DDG.',
  },
} as const satisfies Record<string, UiText | readonly UiText[]>;
