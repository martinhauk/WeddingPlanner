import { Fragment, type ReactNode } from 'react';

const PLACEHOLDER = /(\{[a-zA-Z]+\})/;

/**
 * Replaces `{name}` placeholders in a UI text with `values` (text or elements such as links), so a
 * translation can put a link or a date wherever its grammar needs it. Unknown names stay as written.
 */
export function fill(text: string, values: Readonly<Record<string, ReactNode>>): ReactNode {
  return text.split(PLACEHOLDER).map((part, index) => {
    const name = /^\{([a-zA-Z]+)\}$/.exec(part)?.[1];
    const value = name !== undefined && Object.hasOwn(values, name) ? values[name] : part;
    // biome-ignore lint/suspicious/noArrayIndexKey: the parts of one static text, in a fixed order
    return <Fragment key={index}>{value}</Fragment>;
  });
}
