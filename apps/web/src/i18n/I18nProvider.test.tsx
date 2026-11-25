import { render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { defineStrings } from './define-strings.ts';
import { LANGUAGE_STORAGE_KEY } from './detect-language.ts';
import { I18nProvider } from './I18nProvider.tsx';
import type { UiStringOverrides } from './translate.ts';
import { useLanguage, useStrings } from './use-strings.ts';

const i18n = { languages: ['de', 'en', 'es'], defaultLanguage: 'de' };

const greetingStrings = defineStrings('greeting', {
  de: { hello: 'Willkommen bei {couple}', guests: { one: '{count} Gast', other: '{count} Gäste' } },
  en: { hello: 'Welcome to {couple}', guests: { one: '{count} guest', other: '{count} guests' } },
  es: {
    hello: 'Bienvenidos a {couple}',
    guests: { one: '{count} invitado', other: '{count} invitados' },
  },
});

function Greeting({ guests }: { readonly guests: number }) {
  const t = useStrings(greetingStrings);
  const { language, languages, setLanguage } = useLanguage();
  return (
    <div>
      <p>{t('hello', { couple: 'Anna & Ben' })}</p>
      <p>{t.plural('guests', guests)}</p>
      {languages.map((code) => (
        <button
          key={code}
          type="button"
          aria-pressed={code === language}
          onClick={() => setLanguage(code)}
        >
          {code}
        </button>
      ))}
      <button type="button" onClick={() => setLanguage('fr')}>
        fr
      </button>
    </div>
  );
}

describe('I18nProvider with useStrings and useLanguage', () => {
  afterEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, '', '/');
    document.documentElement.lang = '';
  });

  it('renders strings in the initial language and syncs <html lang>', () => {
    render(
      <I18nProvider i18n={i18n} initialLanguage="es">
        <Greeting guests={1} />
      </I18nProvider>,
    );
    expect(screen.getByText('Bienvenidos a Anna & Ben')).toBeInTheDocument();
    expect(screen.getByText('1 invitado')).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('es');
  });

  it('detects the language when no initial language is given', () => {
    window.history.replaceState(null, '', '/?lang=en');
    render(
      <I18nProvider i18n={i18n}>
        <Greeting guests={2} />
      </I18nProvider>,
    );
    expect(screen.getByText('Welcome to Anna & Ben')).toBeInTheDocument();
    expect(screen.getByText('2 guests')).toBeInTheDocument();
    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('en');
  });

  it('switches the language, persists it, and updates <html lang> and an explicit ?lang', async () => {
    window.history.replaceState(null, '', '/?lang=es');
    const user = userEvent.setup();
    render(
      <I18nProvider i18n={i18n}>
        <Greeting guests={3} />
      </I18nProvider>,
    );
    expect(screen.getByText('3 invitados')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'de' }));
    expect(screen.getByText('Willkommen bei Anna & Ben')).toBeInTheDocument();
    expect(screen.getByText('3 Gäste')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'de' })).toHaveAttribute('aria-pressed', 'true');
    expect(document.documentElement.lang).toBe('de');
    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('de');
    expect(window.location.search).toBe('?lang=de');
  });

  it('ignores a language that content does not list', async () => {
    const user = userEvent.setup();
    render(
      <I18nProvider i18n={i18n} initialLanguage="en">
        <Greeting guests={1} />
      </I18nProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'fr' }));
    expect(screen.getByText('Welcome to Anna & Ben')).toBeInTheDocument();
    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBeNull();
  });

  it('starts in the default language for an initial language content does not list', () => {
    render(
      <I18nProvider i18n={i18n} initialLanguage="it">
        <Greeting guests={1} />
      </I18nProvider>,
    );
    expect(screen.getByText('Willkommen bei Anna & Ben')).toBeInTheDocument();
  });

  it('applies content overrides (uiStrings)', () => {
    const uiStrings: UiStringOverrides = { 'greeting.hello': { de: 'Schön, dass du da bist!' } };
    render(
      <I18nProvider i18n={i18n} uiStrings={uiStrings} initialLanguage="de">
        <Greeting guests={1} />
      </I18nProvider>,
    );
    expect(screen.getByText('Schön, dass du da bist!')).toBeInTheDocument();
  });

  it('gives a content language without a built-in dictionary the English UI text', () => {
    const french = { languages: ['fr', 'de'], defaultLanguage: 'fr' };
    const wrapper = ({ children }: { readonly children: ReactNode }) => (
      <I18nProvider i18n={french} initialLanguage="fr">
        {children}
      </I18nProvider>
    );
    const { result } = renderHook(() => useStrings(greetingStrings), { wrapper });
    expect(result.current('hello', { couple: 'Anna & Ben' })).toBe('Welcome to Anna & Ben');
  });

  it('keeps the translator stable while the language does not change', () => {
    const wrapper = ({ children }: { readonly children: ReactNode }) => (
      <I18nProvider i18n={i18n} initialLanguage="de">
        {children}
      </I18nProvider>
    );
    const { result, rerender } = renderHook(() => useStrings(greetingStrings), { wrapper });
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  it('explains a missing provider', () => {
    expect(() => renderHook(() => useStrings(greetingStrings))).toThrow(/I18nProvider/);
    expect(() => renderHook(() => useLanguage())).toThrow(/I18nProvider/);
  });
});
