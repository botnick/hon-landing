import { useEffect, useState } from 'react';

interface Units {
  day: string;
  hour: string;
  min: string;
  sec: string;
}

/** Live countdown island. Only this tiny component ships JS — the rest is static.
 *  Unit/done labels come from the content's ui dict so they follow the page language. */
export default function Countdown({
  to,
  label,
  units,
  doneLabel,
}: {
  to: string;
  label?: string;
  units?: Units;
  doneLabel?: string;
}) {
  const u: Units = units ?? { day: 'วัน', hour: 'ชม.', min: 'นาที', sec: 'วินาที' };
  const target = to ? new Date(to).getTime() : 0;
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    if (!target) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [target]);

  if (!target || now === null) return null;

  const diff = Math.max(0, target - now);
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  const done = diff === 0;

  // key on the value so React remounts the number → CSS tick animation fires each change
  const cell = (val: number, unit: string) => {
    const str = String(val).padStart(2, '0');
    return (
      <div className="cd-cell">
        <span className="cd-num" key={str}>{str}</span>
        <span className="cd-unit">{unit}</span>
      </div>
    );
  };

  return (
    <div className="cd" role="timer" aria-label={label}>
      {label && <div className="cd-label">{done ? (doneLabel ?? 'เปิดแล้ว') : label}</div>}
      {!done && (
        <div className="cd-grid">
          {cell(d, u.day)}
          <span className="cd-sep">:</span>
          {cell(h, u.hour)}
          <span className="cd-sep">:</span>
          {cell(m, u.min)}
          <span className="cd-sep">:</span>
          {cell(s, u.sec)}
        </div>
      )}
    </div>
  );
}
