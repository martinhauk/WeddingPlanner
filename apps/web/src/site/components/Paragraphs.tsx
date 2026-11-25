export type ParagraphsProps = {
  readonly text: string;
  readonly className?: string;
};

/** Content text: a blank line starts a new paragraph, a single line break stays a line break. */
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
          {paragraph}
        </p>
      ))}
    </>
  );
}
