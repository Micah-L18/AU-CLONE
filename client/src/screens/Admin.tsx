import { useState } from 'react';
import type { Action, Player, Week } from '@shared/types';
import { api } from '../api/client';
import { usePolling } from '../hooks/usePolling';
import PinGate, { lockAdmin } from '../components/PinGate';

export default function Admin() {
  return (
    <PinGate>
      <AdminInner />
    </PinGate>
  );
}

function AdminInner() {
  const { data: players, refresh: refreshPlayers } = usePolling<Player[]>(() => api.players(), 30_000);
  const { data: actions, refresh: refreshActions } = usePolling<Action[]>(() => api.actions(true), 30_000);
  const { data: weeks, refresh: refreshWeeks } = usePolling<Week[]>(() => api.weeks(), 30_000);
  const { data: settings, refresh: refreshSettings } = usePolling<Record<string, string>>(() => api.settings(), 30_000);

  const [newPlayer, setNewPlayer] = useState('');
  const [newAction, setNewAction] = useState({ label: '', points: '' });
  const [weekDate, setWeekDate] = useState(new Date().toISOString().slice(0, 10));
  const [toast, setToast] = useState<string | null>(null);

  const say = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };
  const fail = (e: unknown) => say(e instanceof Error ? e.message : String(e));

  const addPlayer = async () => {
    if (!newPlayer.trim()) return;
    try {
      await api.createPlayer({ name: newPlayer.trim() });
      setNewPlayer('');
      void refreshPlayers();
    } catch (e) { fail(e); }
  };

  const addAction = async () => {
    const points = Number(newAction.points);
    if (!newAction.label.trim() || Number.isNaN(points)) return say('label and points required');
    try {
      await api.createAction({ label: newAction.label.trim(), points });
      setNewAction({ label: '', points: '' });
      void refreshActions();
      say('Action added');
    } catch (e) { fail(e); }
  };

  const nextWeekNumber = (weeks ?? []).reduce((max, w) => Math.max(max, w.week_number), 0) + 1;

  const deleteWeek = async (w: Week) => {
    try {
      // Dry run first so the confirm can say exactly what gets destroyed.
      const preview = await api.deleteWeek(w.id, true);
      const warning =
        preview.events > 0
          ? `Delete week ${w.week_number}? This permanently removes its teams, ` +
            `${preview.matches} matches, and ${preview.events} recorded scoring events. ` +
            `Player season totals will drop accordingly.`
          : `Delete week ${w.week_number}? Its teams and schedule will be removed. ` +
            `No points have been recorded for it.`;
      if (!window.confirm(warning)) return;
      await api.deleteWeek(w.id);
      void refreshWeeks();
      say(`Week ${w.week_number} deleted`);
    } catch (e) { fail(e); }
  };

  const createWeek = async () => {
    try {
      await api.createWeek({ week_number: nextWeekNumber, date: weekDate });
      void refreshWeeks();
      say(`Week ${nextWeekNumber} created — run the draft next`);
    } catch (e) { fail(e); }
  };

  return (
    <div className="page">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
        <h1 className="page-title">Admin</h1>
        <button
          className="small-btn"
          onClick={() => { lockAdmin(); window.location.reload(); }}
        >
          🔒 Lock
        </button>
      </div>
      <p className="page-sub">Players, weeks, and the point values behind every tap.</p>

      <div className="admin-grid">
        <div className="panel">
          <span className="tag">Weeks</span>
          <div className="form-row">
            <input
              type="date"
              className="date-input"
              value={weekDate}
              onChange={(e) => setWeekDate(e.target.value)}
              onClick={(e) => {
                // Anywhere on the field opens the calendar, not just the icon.
                try { e.currentTarget.showPicker?.(); } catch { /* needs user gesture; click qualifies */ }
              }}
            />
            <button className="btn btn-amber" onClick={() => void createWeek()}>
              Create week {nextWeekNumber}
            </button>
          </div>
          {(weeks ?? []).map((w) => (
            <div key={w.id} className="admin-row">
              <span style={{ flex: 1 }}>
                <b className="digits" style={{ fontFamily: 'var(--display)', fontSize: 20 }}>Week {w.week_number}</b>
                &nbsp;<span className="tag">{w.date} · {w.status.replace('_', ' ')}</span>
              </span>
              {w.status === 'draft' && (
                <button
                  className="small-btn"
                  onClick={async () => {
                    try {
                      await api.generateSchedule(w.id);
                      void refreshWeeks();
                      say('Schedule generated — 5 rounds, 2 courts');
                    } catch (e) { fail(e); }
                  }}
                >
                  Generate schedule
                </button>
              )}
              <button
                className="small-btn"
                style={{ color: 'var(--err)' }}
                onClick={() => void deleteWeek(w)}
              >
                Delete
              </button>
            </div>
          ))}

          <div style={{ marginTop: 26 }}>
            <span className="tag">Settings</span>
            <div className="admin-row">
              <span style={{ flex: 1 }}>Set duration (minutes)</span>
              <input
                type="number"
                defaultValue={settings?.set_duration_minutes ?? '20'}
                key={settings?.set_duration_minutes}
                onBlur={async (e) => {
                  try {
                    await api.saveSettings({ set_duration_minutes: e.target.value });
                    void refreshSettings();
                    say('Saved');
                  } catch (err) { fail(err); }
                }}
              />
            </div>
          </div>
        </div>

        <div className="panel">
          <span className="tag">Actions & point values (fully tunable)</span>
          {(actions ?? []).map((a) => (
            <div key={a.id} className={`admin-row ${a.active === 0 ? 'inactive' : ''}`}>
              <span style={{ flex: 1 }}>
                <b>{a.label}</b> <span className="tag">{a.code}{a.system === 1 ? ' · built-in' : ''}</span>
              </span>
              <input
                type="number"
                defaultValue={a.points}
                key={`${a.id}-${a.points}`}
                onBlur={async (e) => {
                  const v = Number(e.target.value);
                  if (v !== a.points && !Number.isNaN(v)) {
                    try { await api.updateAction(a.id, { points: v }); void refreshActions(); say(`${a.label} → ${v} pts`); }
                    catch (err) { fail(err); }
                  }
                }}
              />
              <button
                className="small-btn"
                onClick={async () => {
                  try { await api.updateAction(a.id, { active: a.active === 1 ? 0 : 1 }); void refreshActions(); }
                  catch (err) { fail(err); }
                }}
              >
                {a.active === 1 ? 'Disable' : 'Enable'}
              </button>
              {a.system !== 1 && (
                <button
                  className="small-btn"
                  onClick={async () => {
                    try { await api.deleteAction(a.id); void refreshActions(); }
                    catch (err) { fail(err); }
                  }}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
          <div className="form-row">
            <input placeholder="Label (e.g. Serve Streak)" value={newAction.label}
              onChange={(e) => setNewAction({ ...newAction, label: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && void addAction()} />
            <input placeholder="pts" type="number" style={{ maxWidth: 90 }} value={newAction.points}
              onChange={(e) => setNewAction({ ...newAction, points: e.target.value })} />
            <button className="btn btn-ghost" onClick={() => void addAction()}>Add</button>
          </div>
        </div>

        <div className="panel" style={{ gridColumn: '1 / -1' }}>
          <span className="tag">Players ({(players ?? []).filter((p) => p.active === 1).length} active)</span>
          <div className="form-row" style={{ maxWidth: 480 }}>
            <input placeholder="New player name" value={newPlayer}
              onChange={(e) => setNewPlayer(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void addPlayer()} />
            <button className="btn btn-amber" onClick={() => void addPlayer()}>Add</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '0 20px' }}>
            {(players ?? []).map((p) => (
              <div key={p.id} className={`admin-row ${p.active === 0 ? 'inactive' : ''}`}>
                <span style={{ flex: 1 }}>{p.name}</span>
                <button
                  className="small-btn"
                  onClick={async () => {
                    try { await api.patchPlayer(p.id, { active: p.active === 1 ? 0 : 1 }); void refreshPlayers(); }
                    catch (err) { fail(err); }
                  }}
                >
                  {p.active === 1 ? 'Bench' : 'Activate'}
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
