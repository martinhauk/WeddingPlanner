import { languageName } from './format.ts';

export type LanguageSwitchProps = {
  readonly languages: readonly string[];
  readonly current: string;
  /** Accessible name of the switch, in the current language. */
  readonly label: string;
  readonly onChange: (language: string) => void;
};

/** One toggle button per content language; the pressed one is the current language. */
export function LanguageSwitch({ languages, current, label, onChange }: LanguageSwitchProps) {
  return (
    <nav className="language-switch" aria-label={label}>
      <ul>
        {languages.map((language) => (
          <li key={language}>
            <button
              type="button"
              lang={language}
              aria-pressed={language === current}
              onClick={() => onChange(language)}
            >
              {languageName(language)}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
