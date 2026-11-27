import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RSVP_STATE_EVENT } from '../api/rsvp-client.ts';
import { mockApi, setStateCookie } from '../test/fake-api.ts';
import { content } from '../test/fixture.ts';
import { Hero, heroImages } from './Hero.tsx';

afterEach(() => {
  setStateCookie(null);
  vi.unstubAllGlobals();
});

describe('Hero: the reply of this browser', () => {
  it.each([
    ['de', 'yes', 'Ihr habt zugesagt.', 'Antwort ändern'],
    ['de', 'no', 'Ihr habt abgesagt.', 'Antwort ändern'],
    ['en', 'yes', 'You said yes.', 'Change reply'],
    ['en', 'no', 'You said no.', 'Change reply'],
    ['es', 'yes', 'Habéis dicho que sí.', 'Cambiar respuesta'],
    ['es', 'no', 'Habéis dicho que no.', 'Cambiar respuesta'],
  ] as const)(
    '%s, %s: says so and links to the RSVP section to change it',
    (lang, state, said, change) => {
      const api = mockApi({});
      setStateCookie(state);
      render(<Hero content={content} lang={lang} rsvpId="rsvp" />);
      expect(screen.getByText(said)).toBeInTheDocument();
      expect(screen.getByRole('link', { name: change })).toHaveAttribute('href', '#rsvp');
      expect(screen.queryByRole('link', { name: 'Zusagen' })).toBeNull();
      expect(api.calls).toEqual([]);
    },
  );

  it('follows the state cookie when an RSVP call changes it', () => {
    render(<Hero content={content} lang="de" rsvpId="rsvp" />);
    expect(screen.getByRole('link', { name: 'Zusagen' })).toBeInTheDocument();

    setStateCookie('no');
    act(() => {
      window.dispatchEvent(new Event(RSVP_STATE_EVENT));
    });
    expect(screen.getByText('Ihr habt abgesagt.')).toBeInTheDocument();

    setStateCookie(null);
    act(() => {
      window.dispatchEvent(new Event(RSVP_STATE_EVENT));
    });
    expect(screen.getByRole('link', { name: 'Zusagen' })).toBeInTheDocument();
  });

  it.each([
    ['de', 'Antwort ansehen'],
    ['en', 'View your reply'],
    ['es', 'Ver vuestra respuesta'],
  ] as const)(
    '%s: offers to view the reply, not to change it, after the deadline',
    (lang, view) => {
      const api = mockApi({});
      setStateCookie('yes');
      render(<Hero content={content} lang={lang} rsvpId="rsvp" rsvpClosed />);
      expect(screen.getByRole('link', { name: view })).toHaveAttribute('href', '#rsvp');
      expect(screen.getAllByRole('link')).toHaveLength(1);
      expect(api.calls).toEqual([]);
    },
  );

  it('shows no reply state while RSVP is off', () => {
    setStateCookie('yes');
    render(<Hero content={content} lang="de" rsvpId={undefined} />);
    expect(screen.queryByText('Ihr habt zugesagt.')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });
});

describe('Hero', () => {
  it('shows up to two decorative photos side by side behind the names', () => {
    const { container } = render(
      <Hero
        content={{ ...content, hero: { images: ['hero.png', 'couple/by-the-lake.webp'] } }}
        lang="de"
        rsvpId="rsvp"
      />,
    );
    const section = container.querySelector('section');
    expect(section).toHaveClass('hero', 'has-image', 'images-2');
    const photos = [...container.querySelectorAll('.hero-media img')];
    expect(photos.map((img) => img.getAttribute('src'))).toEqual([
      '/media/hero.png',
      '/media/couple/by-the-lake.webp',
    ]);
    expect(photos.every((img) => img.getAttribute('alt') === '')).toBe(true);
    expect(screen.getByRole('link', { name: 'Zusagen' })).toHaveAttribute('href', '#rsvp');
  });

  it('has no photo layer without images', () => {
    const { container } = render(
      <Hero content={{ ...content, hero: {} }} lang="de" rsvpId={undefined} />,
    );
    expect(container.querySelector('section')).not.toHaveClass('has-image');
    expect(container.querySelector('img')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });
});

describe('heroImages', () => {
  it('prefers images, falls back to image, else none', () => {
    expect(heroImages({ hero: { images: ['a.png', 'b.png'] } })).toEqual(['a.png', 'b.png']);
    expect(heroImages({ hero: { image: 'a.png' } })).toEqual(['a.png']);
    expect(heroImages({ hero: {} })).toEqual([]);
  });
});
