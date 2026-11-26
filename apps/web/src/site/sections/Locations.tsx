import { LocationCard } from '../components/LocationCard.tsx';
import { InlineText } from '../components/Paragraphs.tsx';
import { SectionFrame } from '../components/SectionFrame.tsx';
import { searchUrl } from '../format.ts';
import { t } from '../i18n.ts';
import { ui } from '../ui.ts';
import type { SectionProps } from './types.ts';

export function Locations({ section, ctx }: SectionProps<'locations'>) {
  const { lang } = ctx;
  const { cards, hotels = [] } = section.data;
  return (
    <SectionFrame section={section} lang={lang}>
      <div className="cards">
        {cards.map((location) => (
          <LocationCard key={location.id} location={location} lang={lang} />
        ))}
      </div>
      {hotels.length > 0 && (
        <>
          <h3 className="subheading">{t(ui.hotels, lang)}</h3>
          <ul className="hotels">
            {hotels.map((hotel, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: static content in a fixed order; names may repeat
              <li key={index}>
                <strong>{hotel.name}</strong>
                <span className="muted-inline">{hotel.address}</span>
                {hotel.note !== undefined && (
                  <span>
                    <InlineText text={t(hotel.note, lang)} />
                  </span>
                )}
                <span className="links">
                  {hotel.url !== undefined && (
                    <a href={hotel.url} target="_blank" rel="noreferrer">
                      {t(ui.website, lang)}
                    </a>
                  )}
                  <a
                    href={searchUrl(`${hotel.name}, ${hotel.address}`)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t(ui.route, lang)}
                  </a>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </SectionFrame>
  );
}
