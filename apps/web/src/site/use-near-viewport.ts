import { type RefObject, useEffect, useState } from 'react';

/**
 * Whether the element has come near the viewport; once true it stays true. Used to call the RSVP
 * API only when a guest scrolls to the section, never on page load.
 *
 * Without `IntersectionObserver` it never turns true, so callers also load on interaction.
 */
export function useNearViewport(
  ref: RefObject<Element | null>,
  enabled: boolean,
  rootMargin = '200px 0px',
): boolean {
  const [near, setNear] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!enabled || near || element === null || typeof IntersectionObserver === 'undefined') {
      return undefined;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          setNear(true);
        }
      },
      { rootMargin },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, enabled, near, rootMargin]);

  return near;
}
