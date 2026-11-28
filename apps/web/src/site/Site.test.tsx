import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KEEP_WARM_IDLE_FALLBACK_MS } from './api/keep-warm.ts';
import { Site } from './Site.tsx';
import { json, mockApi, mockIntersectionObserver, openStatus } from './test/fake-api.ts';
import { build, buildWithoutRsvp, content, contentWith, sections } from './test/fixture.ts';

let api: ReturnType<typeof mockApi>;

beforeEach(() => {
  localStorage.clear();
  mockIntersectionObserver();
  api = mockApi({
    'GET /api/health': () => json(200, { status: 'ok' }),
    'GET /api/rsvp/status': () => json(200, openStatus),
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const headings = () =>
  screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent);

describe('Site', () => {
  it('renders the hero from the content', () => {
    render(<Site content={content} build={build} initialLanguage="de" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Anna & Ben' })).toBeInTheDocument();
    expect(screen.getByText('Wir heiraten')).toBeInTheDocument();
    expect(screen.getByText('Samstag, 26. September 2099')).toBeInTheDocument();
    expect(screen.getByRole('timer')).toBeInTheDocument();
    expect(document.title).toBe('Anna & Ben');
  });

  it('renders the visible sections in content order with their headings', () => {
    render(<Site content={content} build={build} initialLanguage="de" />);
    expect(headings()).toEqual([
      'Unsere Geschichte',
      'Ablauf',
      'Anreise',
      'Trauzeugen',
      'Musik',
      'Schon am Freitag in Berlin?',
      'Fragen',
      'Geschenke',
      'Kontakt',
      'Seid ihr dabei?',
    ]);
  });

  it.each(['#%', '#%E0%A4%A'])('renders with a malformed URL fragment (%s)', (hash) => {
    window.location.hash = hash;
    try {
      expect(window.location.hash).toBe(hash);
      render(<Site content={content} build={build} initialLanguage="de" />);
      expect(screen.getByRole('heading', { level: 1, name: 'Anna & Ben' })).toBeInTheDocument();
    } finally {
      window.history.replaceState(null, '', window.location.pathname);
    }
  });

  it('scrolls to the section of a deep link', () => {
    const scrolled: string[] = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function scrollIntoView(this: Element) {
      scrolled.push(this.id);
    };
    window.location.hash = '#faq';
    try {
      render(<Site content={content} build={build} initialLanguage="de" />);
      expect(scrolled).toEqual(['faq']);
    } finally {
      Element.prototype.scrollIntoView = original;
      window.history.replaceState(null, '', window.location.pathname);
    }
  });

  it('opens the RSVP section for a personal edit link, and calls no API before it is in view', () => {
    const scrolled: string[] = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function scrollIntoView(this: Element) {
      scrolled.push(this.id);
    };
    window.location.hash = `#edit=1b86eb8e593b91c86f2d8d37d4fd593a.${'A'.repeat(43)}`;
    try {
      render(<Site content={content} build={build} initialLanguage="de" />);
      expect(scrolled).toEqual(['rsvp']);
      expect(api.calls).toEqual([]);
    } finally {
      Element.prototype.scrollIntoView = original;
      window.history.replaceState(null, '', window.location.pathname);
    }
  });

  it('repeats the deep-link jump while the page resizes, until the visitor scrolls', () => {
    const scrolled: string[] = [];
    const original = Element.prototype.scrollIntoView;
    const originalObserver = globalThis.ResizeObserver;
    let onResize: (() => void) | undefined;
    Element.prototype.scrollIntoView = function scrollIntoView(this: Element) {
      scrolled.push(this.id);
    };
    globalThis.ResizeObserver = class {
      constructor(callback: () => void) {
        onResize = callback;
      }
      observe() {}
      unobserve() {}
      disconnect() {
        onResize = undefined;
      }
    } as unknown as typeof ResizeObserver;
    window.location.hash = '#faq';
    try {
      render(<Site content={content} build={build} initialLanguage="de" />);
      // Late images or fonts above the section change the layout: jump again.
      onResize?.();
      expect(scrolled).toEqual(['faq', 'faq']);
      // The visitor scrolls on their own: the page no longer moves for them.
      window.dispatchEvent(new Event('wheel'));
      onResize?.();
      expect(scrolled).toEqual(['faq', 'faq']);
    } finally {
      Element.prototype.scrollIntoView = original;
      globalThis.ResizeObserver = originalObserver;
      window.history.replaceState(null, '', window.location.pathname);
    }
  });

  it('follows the order of the content, not of the section types', () => {
    render(
      <Site
        content={contentWith(sections.gifts, sections.story, sections.faq)}
        build={build}
        initialLanguage="de"
      />,
    );
    expect(headings()).toEqual(['Geschenke', 'Unsere Geschichte', 'Fragen']);
  });

  it('builds the navigation from the shown sections (nav label, else title, else default)', () => {
    render(<Site content={content} build={build} initialLanguage="de" />);
    const nav = screen.getByRole('navigation', { name: 'Hauptnavigation' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Unsere Geschichte', '#story'],
      ['Ablauf', '#schedule'],
      ['Anreise', '#travel'],
      ['Trauzeugen', '#wedding-party'],
      ['Musik', '#music'],
      ['Schon am Freitag in Berlin?', '#berlin-tips'],
      ['Fragen', '#faq'],
      ['Geschenke', '#gifts'],
      ['Kontakt', '#contact'],
      ['Zusagen', '#rsvp'],
    ]);
    expect(document.getElementById('dresscode')).toBeNull();
  });

  it('shows an "opens soon" note without hero button or API calls when the flag is off', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    render(<Site content={content} build={buildWithoutRsvp} initialLanguage="de" />);
    const section = screen.getByRole('region', { name: 'Seid ihr dabei?' });
    expect(
      within(section).getByText('Die Anmeldung öffnet bald – schaut gern wieder vorbei.'),
    ).toBeInTheDocument();
    expect(within(section).queryByRole('button')).toBeNull();
    expect(within(screen.getByRole('main')).queryByRole('link', { name: 'Zusagen' })).toBeNull();
    expect(
      within(screen.getByRole('navigation')).getByRole('link', { name: 'Zusagen' }),
    ).not.toHaveClass('nav-rsvp');

    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(api.calls).toEqual([]);
  });

  it('calls no API on page load except the keep-warm ping', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    render(<Site content={content} build={build} initialLanguage="de" />);
    expect(api.calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(KEEP_WARM_IDLE_FALLBACK_MS);
    expect(api.calls.map((call) => `${call.method} ${call.url}`)).toEqual(['GET /api/health']);
  });

  it('links the hero button to the RSVP section when the flag is on', () => {
    render(<Site content={content} build={build} initialLanguage="de" />);
    const main = screen.getByRole('main');
    expect(within(main).getAllByRole('link', { name: 'Zusagen' })[0]).toHaveAttribute(
      'href',
      '#rsvp',
    );
  });

  it('switches the language, falls back to German and remembers the choice', async () => {
    const user = userEvent.setup();
    render(<Site content={content} build={build} initialLanguage="de" />);
    await user.click(screen.getByRole('button', { name: 'EN English' }));

    expect(document.documentElement.lang).toBe('en');
    expect(screen.getByRole('button', { name: 'EN English' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByText("We're getting married")).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Our story' })).toBeInTheDocument();
    // No English text in the fixture: the German one is shown.
    expect(screen.getByText('Eure Anwesenheit ist Geschenk genug.')).toBeInTheDocument();
    expect(localStorage.getItem('wp.lang')).toBe('en');

    await user.click(screen.getByRole('button', { name: 'ES Español' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Anna y Ben' })).toBeInTheDocument();
  });

  it('opens and closes the mobile menu', async () => {
    const user = userEvent.setup();
    render(<Site content={content} build={build} initialLanguage="de" />);
    const burger = screen.getByRole('button', { name: 'Menü' });
    expect(burger).toHaveAttribute('aria-expanded', 'false');
    await user.click(burger);
    expect(burger).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard('{Escape}');
    expect(burger).toHaveAttribute('aria-expanded', 'false');
  });

  it('links the privacy notice in the footer, and the imprint only when there is one', () => {
    const { unmount } = render(<Site content={content} build={build} initialLanguage="de" />);
    const footer = screen.getByRole('contentinfo');
    expect(within(footer).getByRole('link', { name: 'Datenschutz' })).toHaveAttribute(
      'href',
      '/datenschutz',
    );
    expect(within(footer).queryByRole('link', { name: 'Impressum' })).toBeNull();
    unmount();

    const withImprint = {
      ...content,
      privacy: { controllers: [{ name: 'Anna' }], imprint: { de: 'Anna, Musterstadt' } },
    };
    render(<Site content={withImprint} build={build} initialLanguage="en" />);
    const links = within(screen.getByRole('contentinfo')).getAllByRole('link');
    expect(links.map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Privacy', '/datenschutz'],
      ['Legal notice', '/datenschutz#impressum'],
    ]);
  });

  it.each(['/datenschutz', '/privacy/'])('shows the privacy notice at %s', async (path) => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    window.history.replaceState(null, '', path);
    try {
      render(<Site content={content} build={build} initialLanguage="de" />);
      expect(
        screen.getByRole('heading', { level: 1, name: 'Datenschutzerklärung' }),
      ).toBeInTheDocument();
      expect(screen.queryByRole('heading', { level: 1, name: 'Anna & Ben' })).toBeNull();
      expect(screen.queryByRole('timer')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Menü' })).toBeNull();
      expect(screen.getByRole('link', { name: 'Anna & Ben' })).toHaveAttribute('href', '/');
      expect(document.title).toBe('Datenschutzerklärung · Anna & Ben');
      expect(
        within(screen.getByRole('contentinfo')).getByRole('link', { name: 'Datenschutz' }),
      ).toBeInTheDocument();

      // No form here, so not even the keep-warm ping.
      await vi.advanceTimersByTimeAsync(KEEP_WARM_IDLE_FALLBACK_MS * 2);
      expect(api.calls).toEqual([]);
    } finally {
      window.history.replaceState(null, '', '/');
    }
  });

  it('switches the language of the privacy notice', async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, '', '/datenschutz');
    try {
      render(<Site content={content} build={build} initialLanguage="de" />);
      await user.click(screen.getByRole('button', { name: 'ES Español' }));
      expect(
        screen.getByRole('heading', { level: 1, name: 'Política de privacidad' }),
      ).toBeInTheDocument();
      expect(document.title).toBe('Política de privacidad · Anna y Ben');
    } finally {
      window.history.replaceState(null, '', '/');
    }
  });

  it('closes the mobile menu on a tap outside the header, not inside it', async () => {
    const user = userEvent.setup();
    render(<Site content={content} build={build} initialLanguage="de" />);
    const burger = screen.getByRole('button', { name: 'Menü' });
    await user.click(burger);
    expect(burger).toHaveAttribute('aria-expanded', 'true');

    await user.pointer({ keys: '[MouseLeft]', target: screen.getByRole('banner') });
    expect(burger).toHaveAttribute('aria-expanded', 'true');

    await user.pointer({ keys: '[MouseLeft]', target: screen.getByRole('main') });
    expect(burger).toHaveAttribute('aria-expanded', 'false');
  });
});
