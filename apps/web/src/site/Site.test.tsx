import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { Site } from './Site.tsx';
import { build, buildWithoutRsvp, content, contentWith, sections } from './test/fixture.ts';

beforeEach(() => {
  localStorage.clear();
});

const headings = () =>
  screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent);

describe('Site', () => {
  it('renders the hero from the content', () => {
    render(<Site content={content} build={build} initialLanguage="de" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Anna & Ben' })).toBeInTheDocument();
    expect(screen.getByText('Wir heiraten')).toBeInTheDocument();
    expect(screen.getByText('Samstag, 20. Juni 2099')).toBeInTheDocument();
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
      "Let's Dance",
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
      ["Let's Dance", '#dance'],
      ['Fragen', '#faq'],
      ['Geschenke', '#gifts'],
      ['Kontakt', '#contact'],
      ['Zusagen', '#rsvp'],
    ]);
    expect(document.getElementById('dresscode')).toBeNull();
  });

  it('hides the RSVP section, its nav entry and the hero button when the flag is off', () => {
    render(<Site content={content} build={buildWithoutRsvp} initialLanguage="de" />);
    expect(document.getElementById('rsvp')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Zusagen' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Ja, wir kommen' })).toBeNull();
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
