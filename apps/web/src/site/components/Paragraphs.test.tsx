import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Paragraphs } from './Paragraphs.tsx';

describe('Paragraphs', () => {
  it('splits paragraphs at blank lines and renders inline links', () => {
    const { container } = render(
      <Paragraphs
        text={
          'Videos:\n[Tango](https://example.com/tango)\n\nWrite to [Anna](mailto:anna@example.com) or [call](tel:+49 151 000)'
        }
      />,
    );
    expect(container.querySelectorAll('p')).toHaveLength(2);
    const tango = screen.getByRole('link', { name: 'Tango' });
    expect(tango).toHaveAttribute('href', 'https://example.com/tango');
    expect(tango).toHaveAttribute('target', '_blank');
    expect(tango).toHaveAttribute('rel', 'noreferrer');
    const mail = screen.getByRole('link', { name: 'Anna' });
    expect(mail).toHaveAttribute('href', 'mailto:anna@example.com');
    expect(mail).not.toHaveAttribute('target');
    expect(screen.getByRole('link', { name: 'call' })).toHaveAttribute('href', 'tel:+49151000');
    expect(container.querySelector('p')).toHaveTextContent('Videos: Tango', {
      normalizeWhitespace: true,
    });
  });

  it('never renders markup or other link schemes from content', () => {
    const { container } = render(
      <Paragraphs text={'<b>bold</b> [x](javascript:alert(1)) [y](http://example.com)'} />,
    );
    expect(screen.queryByRole('link')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(container).toHaveTextContent(
      '<b>bold</b> [x](javascript:alert(1)) [y](http://example.com)',
    );
  });
});
