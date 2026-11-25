import { useEffect, useState } from 'react';
import { type Lang, t } from '../i18n.ts';
import { ui } from '../ui.ts';

export type CountdownProps = {
  /** ISO 8601 instant the countdown runs to. */
  readonly to: string;
  readonly lang: Lang;
};

/** Days, hours, minutes and seconds until `to`; renders nothing once it has passed. */
export function Countdown({ to, lang }: CountdownProps) {
  const target = Date.parse(to);
  const [now, setNow] = useState(() => Date.now());
  const done = now >= target;

  useEffect(() => {
    if (done) {
      return undefined;
    }
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [done]);

  if (done) {
    return null;
  }
  const seconds = Math.floor((target - now) / 1000);
  const parts = [
    { value: Math.floor(seconds / 86400), label: ui.countdown.days },
    { value: Math.floor((seconds % 86400) / 3600), label: ui.countdown.hours },
    { value: Math.floor((seconds % 3600) / 60), label: ui.countdown.minutes },
    { value: seconds % 60, label: ui.countdown.seconds },
  ];
  return (
    <div className="countdown" role="timer" aria-label={t(ui.countdown.label, lang)}>
      {parts.map((part) => (
        <div key={part.label.en}>
          <strong>{part.value}</strong>
          <span>{t(part.label, lang)}</span>
        </div>
      ))}
    </div>
  );
}
