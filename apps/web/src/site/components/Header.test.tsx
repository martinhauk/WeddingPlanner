import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Header, type HeaderProps } from './Header.tsx';

const nav = [
  { id: 'story', label: 'Geschichte' },
  { id: 'travel', label: 'Anreise' },
  { id: 'rsvp', label: 'Zusagen' },
];

function renderHeader(props: Partial<HeaderProps> = {}) {
  return render(
    <>
      <Header
        brand="Anna & Ben"
        nav={nav}
        rsvpId="rsvp"
        lang="de"
        onLangChange={() => {}}
        {...props}
      />
      {nav.map((item) => (
        <section key={item.id} id={item.id} />
      ))}
    </>,
  );
}

/** An IntersectionObserver whose `cross(id)` reports that section as crossing the band. */
function mockObserver() {
  let callback: IntersectionObserverCallback = () => {};
  const targets: Element[] = [];
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(cb: IntersectionObserverCallback) {
        callback = cb;
      }
      observe(target: Element) {
        targets.push(target);
      }
      disconnect() {}
    },
  );
  return {
    cross: (id: string, isIntersecting = true) =>
      act(() => {
        const target = targets.find((t) => t.id === id) as Element;
        callback(
          [{ target, isIntersecting } as IntersectionObserverEntry],
          {} as IntersectionObserver,
        );
      }),
  };
}

function scrollTo(y: number) {
  Object.defineProperty(window, 'scrollY', { value: y, configurable: true });
  act(() => {
    fireEvent.scroll(window);
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
});

describe('Header', () => {
  it('marks the entry of the section in view as the current location', () => {
    const observer = mockObserver();
    renderHeader();
    const link = (name: string) => screen.getByRole('link', { name });
    expect(link('Anreise')).not.toHaveAttribute('aria-current');

    observer.cross('travel');
    expect(link('Anreise')).toHaveAttribute('aria-current', 'location');
    expect(link('Geschichte')).not.toHaveAttribute('aria-current');

    observer.cross('story');
    expect(link('Geschichte')).toHaveAttribute('aria-current', 'location');
    observer.cross('story', false);
    observer.cross('travel', false);
    expect(screen.queryByRole('link', { current: 'location' })).toBeNull();
  });

  it('lies transparent on the hero photo until the page scrolls', () => {
    const { container } = renderHeader({ overHero: true });
    const header = container.querySelector('header');
    expect(header).toHaveClass('over-hero');

    scrollTo(300);
    expect(header).not.toHaveClass('over-hero');
    scrollTo(0);
    expect(header).toHaveClass('over-hero');
  });

  it('is never transparent without a hero photo', () => {
    const { container } = renderHeader();
    expect(container.querySelector('header')).not.toHaveClass('over-hero');
  });

  it('shows the navigation inline when it fits and as a menu when it overflows', () => {
    const { container, unmount } = renderHeader();
    expect(container.querySelector('header')).toHaveClass('inline');
    unmount();

    vi.spyOn(Element.prototype, 'scrollWidth', 'get').mockReturnValue(900);
    vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(400);
    const overflowing = renderHeader();
    expect(overflowing.container.querySelector('header')).toHaveClass('collapsed');
    expect(screen.getByRole('button', { name: 'Menü' })).toHaveAttribute('aria-expanded', 'false');
  });
});
