import { useEffect, useMemo, useRef, useState } from 'react';
import type { LeaderboardRow, Player, Week, WeekMatchesResponse } from '@shared/types';
import { api } from '../api/client';
import { usePolling } from '../hooks/usePolling';

export default function Draft() {
  const { data: weeks } = usePolling<Week[]>(() => api.weeks(), 15_000);
  const { data: players } = usePolling<Player[]>(() => api.players(), 30_000);
  const { data: board } = usePolling<LeaderboardRow[]>(() => api.leaderboard('season'), 30_000);

  const [weekId, setWeekId] = useState<number | null>(null);
  const { data: weekData, refresh } = usePolling<WeekMatchesResponse | null>(
    () => (weekId === null ? Promise.resolve(null) : api.weekMatches(weekId)),
    15_000,
    [weekId]
  );

  // captains[i] is the captain player id of team i (teams sorted by label)
  const [captains, setCaptains] = useState<(number | null)[]>([null, null, null, null, null]);
  const [picks, setPicks] = useState<{ teamIdx: number; playerId: number }[]>([]);
  const [phase, setPhase] = useState<'captains' | 'draft'>('captains');
  const [toast, setToast] = useState<string | null>(null);
  const hydratedWeek = useRef<number | null>(null);
  const suppressSuggest = useRef(false);

  // Default selection: the newest week still in 'draft', else the newest week.
  useEffect(() => {
    if (weekId === null && weeks && weeks.length > 0) {
      const drafting = [...weeks].reverse().find((w) => w.status === 'draft');
      setWeekId((drafting ?? weeks[weeks.length - 1]).id);
    }
  }, [weeks, weekId]);

  // When switching weeks, load whatever draft is already saved on the server
  // so re-opening this screen shows the real rosters instead of a blank slate.
  useEffect(() => {
    if (!weekData || weekData.week.id !== weekId || hydratedWeek.current === weekId) return;
    hydratedWeek.current = weekId;
    suppressSuggest.current = false;
    const teams = weekData.teams;
    const hasRosters = teams.some((t) => t.players.length > 0);
    if (hasRosters || teams.some((t) => t.captain_id !== null)) {
      setCaptains(teams.map((t) => t.captain_id));
      setPicks(
        teams.flatMap((t, i) =>
          t.players
            .filter((p) => p.id !== t.captain_id)
            .map((p) => ({ teamIdx: i, playerId: p.id }))
        )
      );
      setPhase(hasRosters ? 'draft' : 'captains');
    } else {
      setCaptains([null, null, null, null, null]);
      setPicks([]);
      setPhase('captains');
    }
  }, [weekData, weekId]);

  const teams = weekData?.teams ?? [];

  // Suggest the season top 5 as captains — but never over a saved draft
  // (checked against server data, not local state, so hydration in the same
  // commit can't be stomped) and not after the user hit "Clear captains".
  useEffect(() => {
    if (!weekData || weekData.week.id !== weekId || suppressSuggest.current) return;
    const hasSaved = weekData.teams.some((t) => t.captain_id !== null || t.players.length > 0);
    if (hasSaved) return;
    if (board && board.length >= 5 && picks.length === 0 && captains.every((c) => c === null)) {
      setCaptains(board.slice(0, 5).map((r) => r.player_id));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board, weekId, weekData]);

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

  const nameOf = (id: number) => (players ?? []).find((p) => p.id === id)?.name ?? `#${id}`;
  const posOf = (id: number) => (players ?? []).find((p) => p.id === id)?.position ?? null;
  const withPos = (id: number) => (
    <>
      {nameOf(id)}
      {posOf(id) && <span className="pos-tag" style={{ marginLeft: 6 }}>{posOf(id)}</span>}
    </>
  );

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
    if (!weekData || weekId === null) return;
    try {
      await api.submitDraft(weekId, {
        teams: teams.map((t, i) => ({
          week_team_id: t.id,
          captain_id: captains[i],
          player_ids: rosterOf(i),
        })),
      });
      setToast(`Week ${weekData.week.week_number} rosters saved! Generate the schedule from Admin when ready.`);
      void refresh();
    } catch (e) {
      setToast(e instanceof Error ? e.message : String(e));
    }
    setTimeout(() => setToast(null), 4000);
  };

  if (!weeks || weeks.length === 0) {
    return <div className="page"><div className="empty"><b>No week to draft</b>Create the week in Admin first.</div></div>;
  }

  const captainsSet = captains.every((c) => c !== null);
  const pool = activePlayers.filter((p) => !takenIds.has(p.id));
  const savedCount = teams.reduce((n, t) => n + t.players.length, 0);

  return (
    <div className="page">
      <h1 className="page-title">
        {weekData ? `Week ${weekData.week.week_number} Draft` : 'Draft'}
      </h1>

      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <span className="tag">Drafting for:</span>
        {weeks.map((w) => (
          <button
            key={w.id}
            className={`btn ${weekId === w.id ? 'btn-amber' : 'btn-ghost'}`}
            onClick={() => setWeekId(w.id)}
          >
            Wk {w.week_number}
          </button>
        ))}
        {weekData && (
          <span className="tag">
            {weekData.week.date} · {weekData.week.status.replace('_', ' ')}
            {savedCount > 0 ? ` · ${savedCount} players saved` : ' · no rosters saved yet'}
          </span>
        )}
      </div>

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
            <button
              className="btn btn-ghost"
              onClick={() => {
                suppressSuggest.current = true;
                setCaptains([null, null, null, null, null]);
              }}
            >
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
              Save rosters
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
                <span>
                  {p.name}
                  {p.position && <span className="pos-tag" style={{ marginLeft: 8 }}>{p.position}</span>}
                </span>
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
                {captains[i] !== null && <li className="captain">© {withPos(captains[i]!)}</li>}
                {picks.filter((p) => p.teamIdx === i).map((p) => (
                  <li key={p.playerId}>{withPos(p.playerId)}</li>
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
