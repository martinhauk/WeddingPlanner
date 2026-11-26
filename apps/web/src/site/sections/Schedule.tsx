import { InlineText } from '../components/Paragraphs.tsx';
import { SectionFrame } from '../components/SectionFrame.tsx';
import { t } from '../i18n.ts';
import type { SectionProps } from './types.ts';

export function Schedule({ section, ctx }: SectionProps<'schedule'>) {
  const { lang, content } = ctx;
  const locationName = (id: string | undefined) =>
    id === undefined
      ? undefined
      : content.sections
          .flatMap((s) => (s.type === 'locations' ? s.data.cards : []))
          .find((card) => card.id === id)?.name;
  return (
    <SectionFrame section={section} lang={lang}>
      <ol className="timeline">
        {section.data.items.map((item, index) => {
          const where = locationName(item.locationId);
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: static content in a fixed order; items may repeat
            <li key={index}>
              <span className="time">{item.time}</span>
              <span className="what">{t(item.title, lang)}</span>
              {where !== undefined && <span className="where">{where}</span>}
              {item.note !== undefined && (
                <span className="note">
                  <InlineText text={t(item.note, lang)} />
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </SectionFrame>
  );
}
