import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { build, content, sections } from '../test/fixture.ts';
import { Contact } from './Contact.tsx';
import { Gifts } from './Gifts.tsx';
import { Music } from './Music.tsx';
import { Story } from './Story.tsx';

const ctx = { lang: 'de' as const, content, build };

describe('Contact', () => {
  it('offers tel:, WhatsApp and mailto: links for the fields that are set', () => {
    render(<Contact section={sections.contact} ctx={ctx} />);
    expect(screen.getByRole('link', { name: 'Anrufen: Anna' })).toHaveAttribute(
      'href',
      'tel:+4915100000000',
    );
    expect(screen.getByRole('link', { name: 'WhatsApp: Anna' })).toHaveAttribute(
      'href',
      'https://wa.me/4915100000000',
    );
    expect(screen.getByRole('link', { name: 'E-Mail: Ben' })).toHaveAttribute(
      'href',
      'mailto:ben@example.com',
    );
    expect(screen.queryByRole('link', { name: 'Anrufen: Ben' })).toBeNull();
  });
});

describe('text sections', () => {
  it('splits story text into paragraphs', () => {
    render(<Story section={sections.story} ctx={ctx} />);
    expect(screen.getByText('Wir trafen uns im Zug.')).toHaveClass('lead');
    expect(screen.getByText('Seitdem reisen wir zusammen.')).toHaveClass('lead');
  });

  it('shows the music link with the default label', () => {
    render(<Music section={sections.music} ctx={{ ...ctx, lang: 'en' }} />);
    expect(screen.getByRole('link', { name: 'Open playlist' })).toHaveAttribute(
      'href',
      'https://example.com/playlist',
    );
  });

  it('renders the gifts text and nothing else', () => {
    const { container } = render(<Gifts section={sections.gifts} ctx={ctx} />);
    expect(screen.getByText('Eure Anwesenheit ist Geschenk genug.')).toBeInTheDocument();
    expect(container.querySelectorAll('a, button, input')).toHaveLength(0);
  });
});
