import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { build, content, sections } from '../test/fixture.ts';
import { WeddingParty } from './WeddingParty.tsx';

const renderParty = (lang: 'de' | 'en' = 'de') =>
  render(<WeddingParty section={sections.weddingParty} ctx={{ lang, content, build }} />);

describe('WeddingParty', () => {
  it('shows every person with photo or initial, name and role', () => {
    const { container } = renderParty();
    expect(screen.getByRole('button', { name: /Pablo Pérez/ })).toHaveTextContent('Trauzeuge');
    expect(screen.getByRole('button', { name: /María-José García/ })).toHaveTextContent('M');
    expect(container.querySelector('img')).toHaveAttribute('src', '/media/party-1.webp');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens an accessible dialog with role and text on click', async () => {
    const user = userEvent.setup();
    renderParty('en');
    await user.click(screen.getByRole('button', { name: /Pablo Pérez/ }));

    const dialog = screen.getByRole('dialog', { name: 'Pablo Pérez' });
    expect(within(dialog).getByText('Best man')).toBeInTheDocument();
    expect(within(dialog).getByText('Pablo has known Ben since school.')).toBeInTheDocument();
  });

  it('closes with the close button and returns focus to the person', async () => {
    const user = userEvent.setup();
    renderParty();
    const person = screen.getByRole('button', { name: /María-José García/ });
    await user.click(person);
    const dialog = screen.getByRole('dialog', { name: 'María-José García' });
    expect(within(dialog).getByText('María-José ist Annas beste Freundin.')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Schließen' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(person).toHaveFocus();
  });
});
