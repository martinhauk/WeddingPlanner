import { parseInline } from '@weddingplanner/content';

export type InlineTextProps = {
  readonly text: string;
};

/**
 * Content text with its inline links (`[label](https://…)`, `mailto:`, `tel:`). Everything else is
 * plain text; a link with another scheme stays text, so content never becomes markup.
 */
export function InlineText({ text }: InlineTextProps) {
  return (
    <>
      {parseInline(text).map((part, index) =>
        part.href === undefined ? (
          part.text
        ) : (
          <a
            // biome-ignore lint/suspicious/noArrayIndexKey: static text, the order never changes
            key={index}
            href={part.href}
            {...(part.href.startsWith('https:') ? { target: '_blank', rel: 'noreferrer' } : {})}
          >
            {part.text}
          </a>
        ),
      )}
    </>
  );
}

export type ParagraphsProps = {
  readonly text: string;
  readonly className?: string;
};

/**
 * Content text: a blank line starts a new paragraph, a single line break stays a line break, and
 * inline links become links.
 */
export function Paragraphs({ text, className }: ParagraphsProps) {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== '');
  return (
    <>
      {paragraphs.map((paragraph, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static text, the order never changes
        <p key={index} className={className}>
          <InlineText text={paragraph} />
        </p>
      ))}
    </>
  );
}
