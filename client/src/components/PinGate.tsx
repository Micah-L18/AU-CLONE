import { useState, type ReactNode } from 'react';

const PIN = '2187';
const STORE_KEY = 'sideout.admin.unlocked';

export function lockAdmin(): void {
  sessionStorage.removeItem(STORE_KEY);
}

/** Simple courtside gate: keeps stray taps out of Admin, remembered per tab session. */
export default function PinGate({ children }: { children: ReactNode }) {
  const [unlocked, setUnlocked] = useState(() => sessionStorage.getItem(STORE_KEY) === '1');
  const [entry, setEntry] = useState('');
  const [shake, setShake] = useState(false);

  if (unlocked) return <>{children}</>;

  const press = (digit: string) => {
    const next = (entry + digit).slice(0, PIN.length);
    setEntry(next);
    if (next.length === PIN.length) {
      if (next === PIN) {
        sessionStorage.setItem(STORE_KEY, '1');
        setUnlocked(true);
      } else {
        setShake(true);
        setTimeout(() => {
          setEntry('');
          setShake(false);
        }, 450);
      }
    }
  };

  return (
    <div className="page" style={{ maxWidth: 420 }}>
      <h1 className="page-title">Admin</h1>
      <p className="page-sub">Enter the admin PIN to continue.</p>
      <div className={`panel pin-pad ${shake ? 'pin-shake' : ''}`}>
        <div className="pin-dots">
          {Array.from({ length: PIN.length }, (_, i) => (
            <span key={i} className={`pin-dot ${i < entry.length ? 'filled' : ''}`} />
          ))}
        </div>
        <div className="pin-grid">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((key, i) =>
            key === '' ? (
              <span key={i} />
            ) : (
              <button
                key={i}
                className="pin-key"
                onClick={() => (key === '⌫' ? setEntry((e) => e.slice(0, -1)) : press(key))}
              >
                {key}
              </button>
            )
          )}
        </div>
      </div>
    </div>
  );
}
