import { useEffect, useMemo, useState } from 'react';
import type { LeaderboardRow, Player, WeekMatchesResponse } from '@shared/types';
import { api } from '../api/client';
import { usePolling } from '../hooks/usePolling';

export default function Draft() {
  const { data: weekData, refresh } = usePolling<WeekMatchesResponse | null>(async () => {
    const week = await api.currentWeek().catch(() => null);
    if (!week) return null;
    return api.weekMatches(week.id);
  }, 15_000);
  const { data: players } = usePolling<Player[]>(() => api.players(), 30_000);
  const { data: board } = usePolling<LeaderboardRow[]>(() => api.leaderboard('season'), 30_000);

  // captains[i] is the captain player id of team i (teams sorted by label)
  const [captains, setCaptains] = useState<(number | null)[]>([null, null, null, null, null]);
  const [picks, setPicks] = useState<{ teamIdx: number; playerId: number }[]>([]);
  const [phase, setPhase] = useState<'captains' | 'draft'>('captains');
  const [toast, setToast] = useState<string | null>(null);

  const teams = weekData?.teams ?? [];

  // Suggest the season top 5 as captains (falls back to none in week 1).
  useEffect(() => {
    if (board && board.length >= 5 && captains.every((c) => c === null)) {
      setCaptains(board.slice(0, 5).map((r) => r.player_id));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board]);

  const activePlayers = useMemo(
    () => (players ?? []).filter((p) => p.active === 1),
    [players]
  );
  const takenIds = useMemo(() => {
    const s = new Set<number>();
    for (const c of captains) if (c !== null) s.add(c);
    for (const p of picks) s.add(p.playerId);
    return s;
  }, [captains, picks]);

  // Snake order over 5 teams: 0..4, 4..0, 0..4, ...
  const onClockIdx = useMemo(() => {
    const round = Math.floor(picks.length / 5);
    const pos = picks.length % 5;
    return round % 2 === 0 ? pos : 4 - pos;
  }, [picks]);

  const rosterOf = (teamIdx: number) => {
    const ids = [captains[teamIdx], ...picks.filter((p) => p.teamIdx === teamIdx).map((p) => p.playerId)];
    return ids.filter((id): id is number => id !== null);
  };

  const nameOf = (id: number) => activePlayers.find((p) => p.id === id)?.name ?? `#${id}`;

  const pickPlayer = (playerId: number) => {
    if (phase === 'captains') {
      const idx = captains.indexOf(null);
      if (idx === -1) return;
      setCaptains((c) => c.map((v, i) => (i === idx ? playerId : v)));
    } else {
      setPicks((p) => [...p, { teamIdx: onClockIdx, playerId }]);
    }
  };

  const submit = async () => {
    if (!weekData) return;
    try {
      await api.submitDraft(weekData.week.id, {
        teams: teams.map((t, i) => ({
          week_team_id: t.id,
          captain_id: captains[i],
          player_ids: rosterOf(i),
        })),
      });
      setToast('Draft saved! Generate the schedule from Admin when ready.');
      void refresh();
    } catch (e) {
      setToast(e instanceof Error ? e.message : String(e));
    }
    setTimeout(() => setToast(null), 4000);
  };

  if (!weekData) {
    return <div className="page"><div className="empty"><b>No week to draft</b>Create the week in Admin first.</div></div>;
  }

  const captainsSet = captains.every((c) => c !== null);
  const pool = activePlayers.filter((p) => !takenIds.has(p.id));

  return (
    <div className="page">
      <h1 className="page-title">Week {weekData.week.week_number} Draft</h1>
      <p className="page-sub">
        {phase === 'captains'
          ? 'Pick the 5 captains — the season top 5 are pre-suggested. Tap a pool player to fill the next empty captain slot.'
          : `Snake order (1→5, then 5→1). Tap a pool player to send them to the team on the clock.`}
      </p>

      <div style={{ display: 'flex', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
        {phase === 'captains' ? (
          <>
            <button className="btn btn-amber" disabled={!captainsSet} onClick={() => setPhase('draft')}>
              Captains locked — start draft
            </button>
            <button className="btn btn-ghost" onClick={() => setCaptains([null, null, null, null, null])}>
              Clear captains
            </button>
          </>
        ) : (
          <>
            <button className="btn btn-ghost" onClick={() => setPicks((p) => p.slice(0, -1))} disabled={picks.length === 0}>
              ⟲ Undo pick
            </button>
            <button className="btn btn-ghost" onClick={() => setPhase('captains')}>← Back to captains</button>
            <button className="btn btn-amber" onClick={() => void submit()} disabled={pool.length > 0}>
              Submit rosters
            </button>
            {pool.length > 0 && <span className="tag" style={{ alignSelf: 'center' }}>{pool.length} players left to draft</span>}
          </>
        )}
      </div>

      <div className="draft-layout">
        <div className="panel pool">
          <span className="tag">Player pool ({pool.length})</span>
          {pool.map((p) => {
            const rank = (board ?? []).findIndex((r) => r.player_id === p.id);
            return (
              <button key={p.id} className="pool-player" onClick={() => pickPlayer(p.id)}>
                <span>{p.name}</span>
                <span className="tag">{rank >= 0 ? `#${rank + 1}` : 'unranked'}</span>
              </button>
            );
          })}
          {pool.length === 0 && <p style={{ color: 'var(--muted)', padding: 12 }}>Pool empty — everyone's drafted.</p>}
        </div>

        <div className="draft-teams">
          {teams.map((t, i) => (
            <div key={t.id} className={`draft-team ${phase === 'draft' && i === onClockIdx ? 'on-clock' : ''}`}>
              <h4>
                Team {t.label}
                {phase === 'draft' && i === onClockIdx && <span style={{ color: 'var(--amber)' }}>ON CLOCK</span>}
              </h4>
              <ol>
                {captains[i] !== null && <li className="captain">© {nameOf(captains[i]!)}</li>}
                {picks.filter((p) => p.teamIdx === i).map((p) => (
                  <li key={p.playerId}>{nameOf(p.playerId)}</li>
                ))}
                {captains[i] === null && <li style={{ color: 'var(--muted)' }}>captain slot open</li>}
              </ol>
            </div>
          ))}
        </div>
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
