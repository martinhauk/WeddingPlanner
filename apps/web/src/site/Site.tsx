import { useEffect, useState } from 'react';
import { content as c, LANGS, type L, type Lang, type Location, ui } from './content.ts';
import './site.css';

const SECTIONS = ['story', 'schedule', 'locations', 'dresscode', 'faq', 'gifts', 'contact'] as const;

function initialLang(): Lang {
  const saved = localStorage.getItem('wp.lang');
  if (saved && (LANGS as string[]).includes(saved)) return saved as Lang;
  const nav = navigator.language.slice(0, 2);
  return (LANGS as string[]).includes(nav) ? (nav as Lang) : 'de';
}

export function Site() {
  const [lang, setLang] = useState<Lang>(initialLang);
  const [menu, setMenu] = useState(false);
  const t = (l: L) => l[lang];
  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = c.couple;
    localStorage.setItem('wp.lang', lang);
  }, [lang]);
  const dateText = new Intl.DateTimeFormat(lang, { dateStyle: 'full', timeZone: 'Europe/Berlin' }).format(new Date(c.date));

  return (
    <>
      <header className="nav">
        <a className="brand" href="#top">{c.couple}</a>
        <button type="button" className="burger" aria-expanded={menu} aria-label="Menu" onClick={() => setMenu(!menu)}>
          <span /><span /><span />
        </button>
        <nav className={menu ? 'open' : ''} onClick={() => setMenu(false)}>
          {SECTIONS.map((s) => (
            <a key={s} href={`#${s}`}>{t(ui.nav[s])}</a>
          ))}
          <a className="nav-rsvp" href="#rsvp">{t(ui.nav.rsvp)}</a>
        </nav>
        <div className="langs">
          {LANGS.map((l) => (
            <button type="button" key={l} className={l === lang ? 'on' : ''} onClick={() => setLang(l)}>{l.toUpperCase()}</button>
          ))}
        </div>
      </header>

      <main id="top">
        <section className="hero" style={c.heroImage ? { backgroundImage: `url(${c.heroImage})` } : undefined}>
          <div className="hero-inner">
            <p className="eyebrow">{t(c.tagline)}</p>
            <h1>{c.couple}</h1>
            <p className="hero-date">{dateText}</p>
            <p className="hero-place">{t(c.place)}</p>
            <Countdown lang={lang} />
            <a className="btn" href="#rsvp">{t(ui.nav.rsvp)}</a>
          </div>
        </section>

        <Section id="story" title={t(ui.nav.story)}>
          <p className="lead">{t(c.story)}</p>
        </Section>

        <Section id="schedule" title={t(ui.nav.schedule)}>
          <ol className="timeline">
            {c.schedule.map((s) => (
              <li key={s.time}>
                <span className="time">{s.time}</span>
                <span className="what">{t(s.title)}</span>
                <span className="where">{c.locations.find((l) => l.id === s.where)?.name}</span>
              </li>
            ))}
          </ol>
        </Section>

        <Section id="locations" title={t(ui.nav.locations)}>
          <div className="cards">
            {c.locations.map((l) => <LocationCard key={l.id} loc={l} lang={lang} />)}
          </div>
          <h3>{t(ui.hotels)}</h3>
          <ul className="plain">
            {c.hotels.map((h) => (
              <li key={h.name}>
                <a href={h.url} target="_blank" rel="noreferrer">{h.name}</a> – {h.address} ·{' '}
                <a href={mapsUrl(h.address)} target="_blank" rel="noreferrer">{t(ui.route)}</a>
              </li>
            ))}
          </ul>
        </Section>

        <Section id="dresscode" title={t(ui.nav.dresscode)}>
          <p className="lead">{t(c.dresscode)}</p>
        </Section>

        <Section id="faq" title={t(ui.nav.faq)}>
          {c.faq.map((f) => (
            <details key={f.q.de}>
              <summary>{t(f.q)}</summary>
              <p>{t(f.a)}</p>
            </details>
          ))}
        </Section>

        <Section id="gifts" title={t(ui.nav.gifts)}>
          <p className="lead">{t(c.gifts)}</p>
        </Section>

        <Section id="contact" title={t(ui.nav.contact)}>
          <div className="cards">
            {c.contacts.map((p) => (
              <div className="card" key={p.name}>
                <h3>{p.name}</h3>
                <a className="btn small" href={`tel:${p.phone.replace(/\s/g, '')}`}>{t(ui.call)}</a>{' '}
                <a className="btn small ghost" href={`mailto:${p.email}`}>{t(ui.mail)}</a>
              </div>
            ))}
          </div>
        </Section>

        <Rsvp lang={lang} />
      </main>
      <footer>{c.couple} · {dateText}</footer>
    </>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function Countdown({ lang }: { lang: Lang }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const diff = Math.max(0, new Date(c.date).getTime() - now) / 1000;
  const parts = [Math.floor(diff / 86400), Math.floor((diff % 86400) / 3600), Math.floor((diff % 3600) / 60), Math.floor(diff % 60)];
  return (
    <div className="countdown">
      {parts.map((v, i) => (
        <div key={ui.countdown.en[i]}><strong>{v}</strong><span>{ui.countdown[lang][i]}</span></div>
      ))}
    </div>
  );
}

const mapsUrl = (q: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;

function LocationCard({ loc, lang }: { loc: Location; lang: Lang }) {
  const [map, setMap] = useState(false);
  const d = 0.008;
  const embed = `https://www.openstreetmap.org/export/embed.html?bbox=${loc.lng - d},${loc.lat - d / 2},${loc.lng + d},${loc.lat + d / 2}&layer=mapnik&marker=${loc.lat},${loc.lng}`;
  return (
    <div className="card">
      <p className="eyebrow">{loc.kind[lang]}</p>
      <h3>{loc.name}</h3>
      <p>{loc.address}</p>
      {loc.note && <p className="muted">{loc.note[lang]}</p>}
      <div className="map">
        {map ? (
          <iframe title={loc.name} src={embed} loading="lazy" />
        ) : (
          <button type="button" onClick={() => setMap(true)}>
            {ui.showMap[lang]}
            <small>{ui.mapNote[lang]}</small>
          </button>
        )}
      </div>
      <a className="btn small" href={mapsUrl(`${loc.name}, ${loc.address}`)} target="_blank" rel="noreferrer">{ui.route[lang]}</a>
    </div>
  );
}

type Person = { name: string; diet: string };
type Reply = { attending: boolean; people: Person[]; message: string; savedAt: string };
const KEY = 'wp.rsvp';

function Rsvp({ lang }: { lang: Lang }) {
  const r = ui.rsvp;
  const [saved, setSaved] = useState<Reply | null>(() => {
    try {
      return JSON.parse(localStorage.getItem(KEY) ?? 'null') as Reply | null;
    } catch {
      return null;
    }
  });
  const [draft, setDraft] = useState<Reply | null>(null);
  const deadline = new Intl.DateTimeFormat(lang, { dateStyle: 'long' }).format(new Date(c.rsvpDeadline));

  const start = (attending: boolean) =>
    setDraft(saved ? { ...saved, attending } : { attending, people: [{ name: '', diet: '' }], message: '', savedAt: '' });
  const setPerson = (i: number, p: Partial<Person>) =>
    draft && setDraft({ ...draft, people: draft.people.map((x, j) => (j === i ? { ...x, ...p } : x)) });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    const reply = { ...draft, people: draft.people.filter((p) => p.name.trim()), savedAt: new Date().toISOString() };
    // TODO: POST /api/rsvp once the API lands; for now the reply lives in this browser only.
    localStorage.setItem(KEY, JSON.stringify(reply));
    document.cookie = `wp_rsvp_state=${reply.attending ? 'yes' : 'no'}; max-age=31536000; path=/; samesite=lax`;
    setSaved(reply);
    setDraft(null);
  };

  return (
    <section id="rsvp" className="section rsvp">
      <h2>{r.title[lang]}</h2>
      <p className="muted">{r.deadline[lang]} {deadline}</p>
      {draft ? (
        <form onSubmit={submit}>
          {draft.attending ? null : <p className="eyebrow">{r.who[lang]}</p>}
          {draft.people.map((p, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: rows have no stable id
            <fieldset key={i}>
              <label>
                {i === 0 ? r.name[lang] : `${r.companion[lang]} ${i}`}
                <input required={i === 0} value={p.name} autoComplete={i === 0 ? 'name' : 'off'} onChange={(e) => setPerson(i, { name: e.target.value })} />
              </label>
              {draft.attending && (
                <label>
                  {r.diet[lang]}
                  <input value={p.diet} onChange={(e) => setPerson(i, { diet: e.target.value })} />
                </label>
              )}
              {i > 0 && (
                <button type="button" className="link" onClick={() => setDraft({ ...draft, people: draft.people.filter((_, j) => j !== i) })}>
                  {r.remove[lang]}
                </button>
              )}
            </fieldset>
          ))}
          {draft.people.length < 6 && (
            <button type="button" className="link" onClick={() => setDraft({ ...draft, people: [...draft.people, { name: '', diet: '' }] })}>
              {r.addCompanion[lang]}
            </button>
          )}
          <label>
            {r.message[lang]}
            <textarea rows={3} value={draft.message} onChange={(e) => setDraft({ ...draft, message: e.target.value })} />
          </label>
          <div className="row">
            <button type="button" className="btn ghost" onClick={() => setDraft(null)}>{r.back[lang]}</button>
            <button type="submit" className="btn">{r.save[lang]}</button>
          </div>
        </form>
      ) : saved ? (
        <div className="thanks">
          <p className="lead">{saved.attending ? r.thanksYes[lang] : r.thanksNo[lang]}</p>
          <p>{saved.people.map((p) => p.name).join(', ')}</p>
          <button type="button" className="btn ghost" onClick={() => setDraft(saved)}>{r.change[lang]}</button>
        </div>
      ) : (
        <div className="row center">
          <button type="button" className="btn" onClick={() => start(true)}>{r.yes[lang]}</button>
          <button type="button" className="btn ghost" onClick={() => start(false)}>{r.no[lang]}</button>
        </div>
      )}
    </section>
  );
}
