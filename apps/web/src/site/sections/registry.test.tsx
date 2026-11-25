import { render, screen } from '@testing-library/react';
import type { Section } from '@weddingplanner/content';
import { describe, expect, it, vi } from 'vitest';
import { build, buildWithoutRsvp, content, sections } from '../test/fixture.ts';
import { renderSection, SECTION_COMPONENTS } from './registry.tsx';
import { isShown, navItems, sectionTitle } from './titles.ts';
import type { SectionContext } from './types.ts';

const ctx: SectionContext = { lang: 'de', content, build };

describe('section registry', () => {
  it('has a component for every section type of the fixture', () => {
    const types = new Set(Object.values(sections).map((s) => s.type));
    expect(Object.keys(SECTION_COMPONENTS).sort()).toEqual([...types].sort());
  });

  it.each((Object.values(sections) as Section[]).filter((s) => s.visible !== false))(
    'renders a $type section as a landmark with its id',
    (section: Section) => {
      const { container } = render(renderSection(section, ctx));
      const element = container.querySelector('section');
      expect(element).toHaveAttribute('id', section.id);
      expect(element).toHaveClass(`section-${section.type}`);
    },
  );

  it('renders nothing for a hidden section', () => {
    const { container } = render(renderSection(sections.dresscode, ctx));
    expect(container).toBeEmptyDOMElement();
  });

  it('gives every heading an id that no section id can take', () => {
    const lookalike: Section = {
      id: 'story-title',
      type: 'text',
      title: { de: 'Zitat' },
      data: { text: { de: 'Ein Zitat.' } },
    };
    const { container } = render(
      <>
        {renderSection(sections.story, ctx)}
        {renderSection(lookalike, ctx)}
      </>,
    );
    const ids = [...container.querySelectorAll('[id]')].map((element) => element.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(screen.getByRole('region', { name: 'Unsere Geschichte' })).toHaveAttribute(
      'id',
      'story',
    );
    expect(screen.getByRole('region', { name: 'Zitat' })).toHaveAttribute('id', 'story-title');
  });

  it('renders repeated names and questions without duplicate React keys', () => {
    const twice = <T,>(list: readonly T[]): T[] => [...list, ...list];
    const { schedule, locations, weddingParty, faq, contact } = sections;
    const repeated: Section[] = [
      { ...schedule, data: { items: twice(schedule.data.items) } },
      { ...locations, data: { ...locations.data, hotels: twice(locations.data.hotels) } },
      { ...weddingParty, data: { people: twice(weddingParty.data.people) } },
      { ...faq, data: { items: twice(faq.data.items) } },
      { ...contact, data: { people: twice(contact.data.people) } },
    ];
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      render(<div>{repeated.map((section) => renderSection(section, ctx))}</div>);
      expect(consoleError).not.toHaveBeenCalled();
      expect(screen.getAllByText('Pablo Pérez')).toHaveLength(2);
    } finally {
      consoleError.mockRestore();
    }
  });

  it('renders the RSVP section only with the rsvp flag', () => {
    expect(isShown(sections.rsvp, build.features)).toBe(true);
    expect(isShown(sections.rsvp, buildWithoutRsvp.features)).toBe(false);
    const { container } = render(renderSection(sections.rsvp, { ...ctx, build: buildWithoutRsvp }));
    expect(container).toBeEmptyDOMElement();
  });
});

describe('titles and navigation', () => {
  it('takes the title, else the default heading of the type', () => {
    expect(sectionTitle(sections.locations, 'en')).toBe('Travel');
    expect(sectionTitle(sections.story, 'en')).toBe('Our story');
    expect(sectionTitle(sections.dance, 'es')).toBe("Let's Dance");
  });

  it('leaves a text section without title out of the heading and the navigation', () => {
    const untitled: Section = { id: 'quote', type: 'text', data: { text: { de: 'Zitat' } } };
    render(renderSection(untitled, ctx));
    expect(screen.queryByRole('heading')).toBeNull();
    expect(navItems({ ...content, sections: [untitled] }, build.features, 'de')).toEqual([]);
  });

  it('lists shown sections only, with the nav label first', () => {
    const items = navItems(content, buildWithoutRsvp.features, 'en');
    expect(items.map((item) => item.id)).not.toContain('dresscode');
    expect(items.map((item) => item.id)).not.toContain('rsvp');
    expect(items.find((item) => item.id === 'faq')?.label).toBe('FAQ');
  });
});
