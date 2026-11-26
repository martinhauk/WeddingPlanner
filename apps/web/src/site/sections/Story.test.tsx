import { render, screen, within } from '@testing-library/react';
import type { SectionOf } from '@weddingplanner/content';
import { describe, expect, it } from 'vitest';
import { build, content, sections } from '../test/fixture.ts';
import { Story } from './Story.tsx';

const story: SectionOf<'story'> = {
  ...sections.story,
  data: {
    ...sections.story.data,
    items: [
      {
        heading: { de: 'Wie habt ihr euch kennengelernt?', en: 'How did you meet?' },
        text: { de: 'Im Speisewagen.\n\nBeim letzten Kaffee.', en: 'In the dining car.' },
      },
      { text: { de: 'Ohne Überschrift.' } },
    ],
  },
};

describe('Story', () => {
  it('shows the introduction, then each part under its own heading', () => {
    render(<Story section={story} ctx={{ lang: 'de', content, build }} />);
    const parts = screen.getAllByRole('article');
    expect(parts).toHaveLength(2);
    expect(
      within(parts[0] as HTMLElement).getByRole('heading', {
        level: 3,
        name: 'Wie habt ihr euch kennengelernt?',
      }),
    ).toBeInTheDocument();
    expect(within(parts[0] as HTMLElement).getAllByText(/Speisewagen|Kaffee/)).toHaveLength(2);
    expect(within(parts[1] as HTMLElement).queryByRole('heading')).toBeNull();
    expect(screen.getByText('Wir trafen uns im Zug.')).toBeInTheDocument();
  });

  it('uses the visitor language with German as the fallback', () => {
    render(<Story section={story} ctx={{ lang: 'en', content, build }} />);
    expect(screen.getByRole('heading', { level: 3, name: 'How did you meet?' })).toBeVisible();
    expect(screen.getByText('Ohne Überschrift.')).toBeInTheDocument();
  });
});
