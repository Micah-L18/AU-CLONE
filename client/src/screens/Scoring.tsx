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
  kind: 'action' | 'score';
  label: string;
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

  // Queue changes fire on enqueue AND after a sync completes — refreshing then
  // closes the gap where a tap has left the queue but the next poll hasn't
  // landed yet (otherwise the optimistic bump blinks away for a beat).
  useEffect(
    () =>
      onQueueChange(() => {
        setQueueVersion((n) => n + 1);
        void refresh();
      }),
    [refresh]
  );

  // Optimistic layer: server state + taps still sitting in the local queue.
  // Action taps: the earner banks player points, roster teammates bank team
  // points. Score taps: +1 on the tapped team's rally score.
  const { totalsByPlayer, extraScoreByTeam, pendingCount } = useMemo(() => {
    const totals = new Map<number, number>();
    for (const t of data?.totals ?? []) totals.set(t.player_id, t.total);
    const teammates = new Map<number, number[]>();
    for (const team of data ? [data.home, data.away] : []) {
      for (const p of team.players) {
        teammates.set(p.id, team.players.filter((q) => q.id !== p.id).map((q) => q.id));
      }
    }
    const queued = pendingForMatch(matchId);
    const actionById = new Map((actions ?? []).map((a) => [a.id, a]));
    const extraScore = new Map<number, number>();
    for (const tap of queued) {
      if (tap.kind === 'score') {
        if (tap.team_id !== undefined) {
          extraScore.set(tap.team_id, (extraScore.get(tap.team_id) ?? 0) + (tap.delta ?? 1));
        }
        continue;
      }
      if (tap.player_id === undefined || tap.action_id === undefined) continue;
      const action = actionById.get(tap.action_id);
      totals.set(tap.player_id, (totals.get(tap.player_id) ?? 0) + (action?.points ?? 0));
      const teamPts = action?.team_points ?? 0;
      if (teamPts !== 0) {
        for (const mate of teammates.get(tap.player_id) ?? []) {
          totals.set(mate, (totals.get(mate) ?? 0) + teamPts);
        }
      }
    }
    return { totalsByPlayer: totals, extraScoreByTeam: extraScore, pendingCount: queued.length };
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
  const teamScore = (t: TeamWithRoster, base: number) => base + (extraScoreByTeam.get(t.id) ?? 0);

  const recordTap = (player: Player, action: Action) => {
    const client_id = crypto.randomUUID();
    enqueueTap({ client_id, match_id: match.id, kind: 'action', player_id: player.id, action_id: action.id });
    const fmt = (n: number) => (n > 0 ? `+${n}` : `${n}`);
    setUndoStack((s) => [
      ...s,
      {
        client_id,
        kind: 'action',
        label: `${player.name} — ${action.label} (${fmt(action.points)} · ${fmt(action.team_points)} each teammate)`,
      },
    ]);
    setTappedPlayer(null);
  };

  const recordPoint = (team: TeamWithRoster) => {
    const client_id = crypto.randomUUID();
    enqueueTap({ client_id, match_id: match.id, kind: 'score', team_id: team.id, delta: 1 });
    setUndoStack((s) => [...s, { client_id, kind: 'score', label: `${teamName(team)} +1 point` }]);
  };

  const undo = async () => {
    const last = undoStack[undoStack.length - 1];
    if (!last) return;
    setUndoStack((s) => s.slice(0, -1));
    if (!removeQueued(last.client_id)) {
      const serverId = serverIdFor(last.client_id);
      if (serverId !== undefined) {
        if (last.kind === 'score') await api.deleteScoreTap(serverId).catch(() => {});
        else await api.deleteEvent(serverId).catch(() => {});
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
          <button className="plus-btn" disabled={match.status === 'final'} onClick={() => recordPoint(home)}>
            +1
          </button>
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
          <button className="plus-btn away" disabled={match.status === 'final'} onClick={() => recordPoint(away)}>
            +1
          </button>
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
            ? <>Last: <b>{lastTap.label}</b></>
            : '+1 for the rally score · tap a player for their stats.'}
        </span>
        <button className="undo-btn" disabled={!lastTap} onClick={() => void undo()}>
          ⟲ Undo
        </button>
      </div>
    </div>
  );
}
