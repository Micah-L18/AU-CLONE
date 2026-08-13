import { useEffect, useState } from 'react';

interface Props {
  startedAt: string | null; // sqlite datetime('now') — UTC, no timezone suffix
  durationMinutes: number;
}

function remainingSeconds(startedAt: string, durationMinutes: number): number {
  const started = new Date(startedAt.replace(' ', 'T') + 'Z').getTime();
  const ends = started + durationMinutes * 60_000;
  return Math.max(0, Math.round((ends - Date.now()) / 1000));
}

export default function Timer({ startedAt, durationMinutes }: Props) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const secs = startedAt ? remainingSeconds(startedAt, durationMinutes) : durationMinutes * 60;
  const mm = String(Math.floor(secs / 60)).padStart(2, '0');
  const ss = String(secs % 60).padStart(2, '0');
  return <div className={`clock ${startedAt && secs <= 60 ? 'low' : ''}`}>{mm}:{ss}</div>;
}
