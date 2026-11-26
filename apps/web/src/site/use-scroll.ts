import { type RefObject, useEffect, useLayoutEffect, useState } from 'react';

/**
 * Whether the page is scrolled more than `threshold` pixels down. Browsers fire `scroll` at most
 * once per frame, and React skips the render while the answer stays the same.
 */
export function useScrolled(threshold = 24): boolean {
  const [scrolled, setScrolled] = useState(() => window.scrollY > threshold);

  useEffect(() => {
    const update = () => setScrolled(window.scrollY > threshold);
    update();
    window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, [threshold]);

  return scrolled;
}

/**
 * The id of the section (out of `ids`, in page order) that crosses a thin band just above the
 * middle of the viewport, for highlighting its navigation entry; `undefined` above the first one
 * and without `IntersectionObserver`.
 */
export function useActiveSection(ids: readonly string[]): string | undefined {
  const [active, setActive] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') {
      return undefined;
    }
    const crossing = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            crossing.add(entry.target.id);
          } else {
            crossing.delete(entry.target.id);
          }
        }
        setActive(ids.find((id) => crossing.has(id)));
      },
      { rootMargin: '-40% 0px -55% 0px' },
    );
    for (const id of ids) {
      const element = document.getElementById(id);
      if (element !== null) {
        observer.observe(element);
      }
    }
    return () => observer.disconnect();
  }, [ids]);

  return active;
}

/** `measuring` renders the navigation inline (before paint) so that its overflow can be read. */
export type NavFit = 'measuring' | 'fits' | 'overflows';

/**
 * Whether the inline navigation `nav` fits into the header without overflowing. It is measured
 * inline, before paint: on mount, when `remeasure` changes (e.g. the language), when `container`
 * changes width and once the web fonts have loaded. While it does not fit, the header shows the
 * menu button instead. Without `ResizeObserver` (jsdom) it is measured on mount only.
 */
export function useNavFit(
  container: RefObject<HTMLElement | null>,
  nav: RefObject<HTMLElement | null>,
  remeasure: string,
): NavFit {
  const [state, setState] = useState<NavFit>('measuring');

  // biome-ignore lint/correctness/useExhaustiveDependencies: `remeasure` is the trigger itself
  useLayoutEffect(() => {
    setState('measuring');
  }, [remeasure]);

  useLayoutEffect(() => {
    if (state !== 'measuring') {
      return;
    }
    const element = nav.current;
    setState(element !== null && element.scrollWidth > element.clientWidth ? 'overflows' : 'fits');
  }, [state, nav]);

  useEffect(() => {
    const element = container.current;
    if (element === null || typeof ResizeObserver === 'undefined') {
      return undefined;
    }
    let live = true;
    let width = element.getBoundingClientRect().width;
    const observer = new ResizeObserver(() => {
      const next = element.getBoundingClientRect().width;
      if (next !== width) {
        width = next;
        setState('measuring');
      }
    });
    observer.observe(element);
    document.fonts?.ready.then(() => {
      if (live) {
        setState('measuring');
      }
    });
    return () => {
      live = false;
      observer.disconnect();
    };
  }, [container]);

  return state;
}
