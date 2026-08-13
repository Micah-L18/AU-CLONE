import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Action, MatchDetailResponse, Player, TeamWithRoster } from '@shared/types';
import { api } from '../api/client';
import { usePolling } from '../hooks/usePolling';
import {
  enqueueTap,
  pendingForMatch,
  removeQueued,
  serverIdFor,
  onQueueChange,
} from '../offline/queue';
import ActionPopover from '../components/ActionPopover';
import Timer from '../components/Timer';
import { useEffect } from 'react';

interface UndoEntry {
  client_id: string;
  player: Player;
  action: Action;
}

export default function Scoring() {
  const { matchId: matchIdParam } = useParams();
  const matchId = Number(matchIdParam);

  const { data, refresh } = usePolling<MatchDetailResponse>(() => api.match(matchId), 2500, [matchId]);
  const { data: actions } = usePolling<Action[]>(() => api.actions(), 30_000);
  const { data: settings } = usePolling<Record<string, string>>(() => api.settings(), 60_000);

  const [tappedPlayer, setTappedPlayer] = useState<Player | null>(null);
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([]);
  const [pickingWinner, setPickingWinner] = useState(false);
  const [queueVersion, setQueueVersion] = useState(0);

  useEffect(() => onQueueChange(() => setQueueVersion((n) => n + 1)), []);

  // Optimistic layer: server totals + taps still sitting in the local queue.
  const { totalsByPlayer, extraScore, pendingCount } = useMemo(() => {
    const totals = new Map<number, number>();
    for (const t of data?.totals ?? []) totals.set(t.player_id, t.total);
    const queued = pendingForMatch(matchId);
    const actionById = new Map((actions ?? []).map((a) => [a.id, a]));
    const extra = new Map<number, number>();
    for (const tap of queued) {
      const pts = actionById.get(tap.action_id)?.points ?? 0;
      totals.set(tap.player_id, (totals.get(tap.player_id) ?? 0) + pts);
      extra.set(tap.player_id, (extra.get(tap.player_id) ?? 0) + pts);
    }
    return { totalsByPlayer: totals, extraScore: extra, pendingCount: queued.length };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, actions, matchId, queueVersion]);

  if (!data || !actions) {
    return <div className="page"><div className="empty"><b>Loading match…</b></div></div>;
  }

  const { match, home, away } = data;
  const durationMinutes = Number(settings?.set_duration_minutes ?? '20');

  const teamName = (t: TeamWithRoster) => {
    const captain = t.players.find((p) => p.id === t.captain_id);
    return captain ? `Team ${captain.name.split(' ')[0]}` : `Team ${t.label}`;
  };
  const teamScore = (t: TeamWithRoster, base: number) =>
    base + t.players.reduce((sum, p) => sum + (extraScore.get(p.id) ?? 0), 0);

  const recordTap = (player: Player, action: Action) => {
    const client_id = crypto.randomUUID();
    enqueueTap({ client_id, match_id: match.id, player_id: player.id, action_id: action.id });
    setUndoStack((s) => [...s, { client_id, player, action }]);
    setTappedPlayer(null);
  };

  const undo = async () => {
    const last = undoStack[undoStack.length - 1];
    if (!last) return;
    setUndoStack((s) => s.slice(0, -1));
    if (!removeQueued(last.client_id)) {
      const serverId = serverIdFor(last.client_id);
      if (serverId !== undefined) {
        await api.deleteEvent(serverId).catch(() => {});
      }
    }
    void refresh();
  };

  const startSet = async () => {
    await api.patchMatch(match.id, { status: 'live' });
    void refresh();
  };

  const finalize = async (winnerTeamId: number | null) => {
    await api.patchMatch(match.id, { status: 'final', winner_team_id: winnerTeamId });
    setPickingWinner(false);
    void refresh();
  };

  const lastTap = undoStack[undoStack.length - 1];

  return (
    <div className="page" style={{ paddingBottom: 120 }}>
      <p className="page-sub">
        <Link to="/">← Rounds</Link> &nbsp;·&nbsp; Round {match.round_number} · Court {match.court}
        {match.status === 'final' && <span style={{ color: 'var(--ok)' }}> · FINAL</span>}
      </p>

      <div className="score-header">
        <div className="score-team home">
          <div className="name">{teamName(home)}</div>
          <div className="pts digits">{teamScore(home, data.home_score)}</div>
        </div>
        <div className="score-mid">
          <Timer startedAt={match.started_at} durationMinutes={durationMinutes} />
          {match.status === 'pending' && (
            <button className="btn btn-amber" onClick={startSet}>Start set</button>
          )}
          {match.status === 'live' && (
            <button className="btn btn-danger" onClick={() => setPickingWinner(true)}>End set</button>
          )}
          {match.status === 'final' && (
            <button className="btn btn-ghost" onClick={() => setPickingWinner(true)}>Change winner</button>
          )}
        </div>
        <div className="score-team away">
          <div className="name">{teamName(away)}</div>
          <div className="pts digits">{teamScore(away, data.away_score)}</div>
        </div>
      </div>

      <div className="scoring-grid">
        {([['home', home], ['away', away]] as const).map(([side, team]) => (
          <div key={side} className={`team-col ${side}`}>
            <div className="col-head">{teamName(team)}</div>
            {team.players.map((p) => (
              <button key={p.id} className="player-btn" onClick={() => setTappedPlayer(p)}>
                <span className="pname">
                  {p.name}
                  {p.id === team.captain_id && <span style={{ color: 'var(--amber)' }}> ©</span>}
                </span>
                <span className="ptotal digits">{totalsByPlayer.get(p.id) ?? 0}</span>
              </button>
            ))}
          </div>
        ))}
      </div>

      {tappedPlayer && (
        <ActionPopover
          player={tappedPlayer}
          actions={actions}
          onPick={(a) => recordTap(tappedPlayer, a)}
          onClose={() => setTappedPlayer(null)}
        />
      )}

      {pickingWinner && (
        <div className="overlay" onClick={() => setPickingWinner(false)}>
          <div className="popover" onClick={(e) => e.stopPropagation()}>
            <h3>Who won the set?</h3>
            <div className="action-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <button className="action-btn" onClick={() => void finalize(home.id)}>
                <span className="alabel">{teamName(home)}</span>
                <span className="apts">{teamScore(home, data.home_score)} pts</span>
              </button>
              <button className="action-btn" onClick={() => void finalize(away.id)}>
                <span className="alabel">{teamName(away)}</span>
                <span className="apts">{teamScore(away, data.away_score)} pts</span>
              </button>
            </div>
            <div style={{ marginTop: 18, display: 'flex', justifyContent: 'space-between' }}>
              <button className="btn btn-ghost" onClick={() => void finalize(null)}>Finalize with no winner</button>
              <button className="btn btn-ghost" onClick={() => setPickingWinner(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      <div className="undo-bar">
        <span className={`sync-badge ${pendingCount > 0 ? 'dirty' : ''}`}>
          {pendingCount > 0 ? `${pendingCount} unsynced` : 'synced'}
        </span>
        <span className="last-tap">
          {lastTap
            ? <>Last: <b>{lastTap.player.name}</b> — {lastTap.action.label} ({lastTap.action.points > 0 ? '+' : ''}{lastTap.action.points})</>
            : 'Tap a player, then the action.'}
        </span>
        <button className="undo-btn" disabled={!lastTap} onClick={() => void undo()}>
          ⟲ Undo
        </button>
      </div>
    </div>
  );
}
