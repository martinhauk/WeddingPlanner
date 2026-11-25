export type FoundText = {
  readonly path: PropertyKey[];
  readonly text: Record<string, string | undefined>;
};

/**
 * Finds the JSON paths of the `{ <lang>: text }` objects collected while parsing (see
 * `collectLocalizedTexts`), in document order.
 */
export function findLocalizedTexts(root: unknown, targets: Set<object>): FoundText[] {
  const found: FoundText[] = [];
  const visit = (node: unknown, at: PropertyKey[]): void => {
    if (typeof node !== 'object' || node === null) {
      return;
    }
    if (targets.has(node)) {
      found.push({ path: at, text: node as Record<string, string | undefined> });
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((child, index) => {
        visit(child, [...at, index]);
      });
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      visit(child, [...at, key]);
    }
  };
  visit(root, []);
  return found;
}
