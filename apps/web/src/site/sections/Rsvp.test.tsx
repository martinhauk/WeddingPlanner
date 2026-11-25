import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { build, content, sections } from '../test/fixture.ts';
import { Rsvp } from './Rsvp.tsx';

const renderRsvp = () =>
  render(<Rsvp section={sections.rsvp} ctx={{ lang: 'de', content, build }} />);
const stored = () => JSON.parse(localStorage.getItem('wp.rsvp.v2') ?? 'null');

beforeEach(() => {
  localStorage.clear();
});

describe('Rsvp', () => {
  it('shows the intro and the display deadline', () => {
    renderRsvp();
    expect(screen.getByText('Wir freuen uns auf eure Antwort.')).toBeInTheDocument();
    expect(screen.getByText('Bitte antwortet bis 1. Mai 2099')).toBeInTheDocument();
  });

  it('falls back to the enforced deadline without a display date', () => {
    const { rsvpDeadline: _, ...withoutDate } = content;
    render(<Rsvp section={sections.rsvp} ctx={{ lang: 'en', content: withoutDate, build }} />);
    expect(screen.getByText('Please reply by May 1, 2099')).toBeInTheDocument();
  });

  it('saves a yes with companions and dietary needs per person', async () => {
    const user = userEvent.setup();
    renderRsvp();
    await user.click(screen.getByRole('button', { name: 'Ja, wir kommen' }));

    const you = screen.getByRole('group', { name: 'Du' });
    await user.type(within(you).getByRole('textbox', { name: 'Name' }), 'Jürgen Müller');
    await user.click(within(you).getByRole('checkbox', { name: 'Vegetarisch' }));
    await user.click(within(you).getByRole('checkbox', { name: 'Laktosefrei' }));

    await user.click(screen.getByRole('button', { name: '+ Begleitung hinzufügen' }));
    const companion = screen.getByRole('group', { name: 'Begleitung 1' });
    await user.type(within(companion).getByRole('textbox', { name: 'Name' }), 'Pablo Pérez');
    await user.type(
      within(companion).getByRole('textbox', { name: 'Allergien oder Hinweise (optional)' }),
      'Nüsse',
    );
    await user.type(screen.getByRole('textbox', { name: 'Nachricht an uns (optional)' }), 'Hurra!');
    await user.click(screen.getByRole('button', { name: 'Antwort speichern' }));

    expect(screen.getByText('Danke! Wir freuen uns auf euch.')).toBeInTheDocument();
    expect(screen.getByText('Jürgen Müller, Pablo Pérez')).toBeInTheDocument();
    expect(stored()).toMatchObject({
      attending: true,
      people: [
        { name: 'Jürgen Müller', diet: ['vegetarian', 'lactoseFree'], dietNote: '' },
        { name: 'Pablo Pérez', diet: [], dietNote: 'Nüsse' },
      ],
      message: 'Hurra!',
    });
  });

  it('lets a no list several names, without dietary questions', async () => {
    const user = userEvent.setup();
    renderRsvp();
    await user.click(screen.getByRole('button', { name: 'Leider nicht' }));
    expect(screen.getByText('Wer kann nicht kommen?')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).toBeNull();

    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'María-José García');
    await user.click(screen.getByRole('button', { name: '+ Weitere Person' }));
    await user.type(
      within(screen.getByRole('group', { name: 'Begleitung 1' })).getByRole('textbox'),
      'Jürgen Müller',
    );
    await user.click(screen.getByRole('button', { name: 'Antwort speichern' }));

    expect(screen.getByText('Schade – danke für eure Rückmeldung.')).toBeInTheDocument();
    expect(stored()).toMatchObject({
      attending: false,
      people: [{ name: 'María-José García' }, { name: 'Jürgen Müller' }],
    });
  });

  it('allows at most six people (one guest and five companions)', async () => {
    const user = userEvent.setup();
    renderRsvp();
    await user.click(screen.getByRole('button', { name: 'Ja, wir kommen' }));
    for (let i = 0; i < 5; i++) {
      await user.click(screen.getByRole('button', { name: '+ Begleitung hinzufügen' }));
    }
    expect(screen.getAllByRole('textbox', { name: 'Name' })).toHaveLength(6);
    expect(screen.queryByRole('button', { name: '+ Begleitung hinzufügen' })).toBeNull();
  });

  it('ignores a stored reply in an unknown format', () => {
    localStorage.setItem('wp.rsvp.v2', JSON.stringify({ attending: 'maybe' }));
    renderRsvp();
    expect(screen.getByRole('button', { name: 'Ja, wir kommen' })).toBeInTheDocument();
  });
});
