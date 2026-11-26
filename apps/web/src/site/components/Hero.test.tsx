import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { content } from '../test/fixture.ts';
import { Hero, heroImages } from './Hero.tsx';

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
