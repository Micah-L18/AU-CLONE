import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { usePolling } from '../hooks/usePolling';
import type { Match, Week, WeekMatchesResponse } from '@shared/types';

function statusDot(status: string) {
  return <span className={`status-dot status-${status === 'live' ? 'live' : status === 'final' ? 'final' : 'pending'}`} />;
}

export default function RoundControl() {
  const { data: weeks } = usePolling<Week[]>(() => api.weeks(), 15_000);
  const [weekId, setWeekId] = useState<number | null>(null);
  // null = follow the live round; a number = user browsing a specific round.
  const [viewRound, setViewRound] = useState<number | null>(null);

  // Default to the server's notion of the current week once weeks load.
  useEffect(() => {
    if (weekId === null && weeks && weeks.length > 0) {
      void api
        .currentWeek()
        .then((w) => setWeekId(w.id))
        .catch(() => setWeekId(weeks[weeks.length - 1].id));
    }
  }, [weeks, weekId]);

  const { data, error } = usePolling<WeekMatchesResponse | null>(
    () => (weekId === null ? Promise.resolve(null) : api.weekMatches(weekId)),
    3000,
    [weekId]
  );

  if (error && !data) return <div className="page"><div className="empty"><b>Can't reach the server</b>{error}</div></div>;
  if (!weeks || weeks.length === 0) {
    return <div className="page"><div className="empty"><b>No week yet</b>Create a week in Admin, run the draft, and generate the schedule.</div></div>;
  }
  if (!data) return <div className="page"><div className="empty"><b>Loading…</b></div></div>;

  const weekStrip = (
    <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
      <span className="tag">Week:</span>
      {weeks.map((w) => (
        <button
          key={w.id}
          className={`btn ${weekId === w.id ? 'btn-amber' : 'btn-ghost'}`}
          onClick={() => { setWeekId(w.id); setViewRound(null); }}
        >
          Wk {w.week_number}
        </button>
      ))}
    </div>
  );

  if (data.rounds.length === 0) {
    return (
      <div className="page">
        <h1 className="page-title">Week {data.week.week_number}</h1>
        {weekStrip}
        <div className="empty"><b>No schedule yet</b>Finish the draft, then generate the schedule from the Admin screen.</div>
      </div>
    );
  }

  const teamById = new Map(data.teams.map((t) => [t.id, t]));
  const teamName = (id: number) => {
    const t = teamById.get(id);
    if (!t) return '?';
    const captain = t.players.find((p) => p.id === t.captain_id);
    return captain ? `Team ${captain.name.split(' ')[0]}` : `Team ${t.label}`;
  };

  // Live round: first round with an unfinished match, else the last.
  const live =
    data.rounds.find((r) => r.matches.some((m) => m.status !== 'final')) ??
    data.rounds[data.rounds.length - 1];
  const shown = data.rounds.find((r) => r.round_number === viewRound) ?? live;
  const browsing = shown !== live;
  const shownDone = shown.matches.every((m) => m.status === 'final');
  const byeTeam = shown.bye_team_id ? teamById.get(shown.bye_team_id) : null;

  return (
    <div className="page">
      <h1 className="page-title">Week {data.week.week_number} — Round {shown.round_number}</h1>
      <p className="page-sub">{data.week.date} · {data.week.status.replace('_', ' ')}</p>

      {weekStrip}

      <div className="round-strip">
        {data.rounds.map((r) => {
          const done = r.matches.every((m) => m.status === 'final');
          return (
            <button
              key={r.round_number}
              className={`round-pill ${r === shown ? 'current' : done ? 'done' : ''}`}
              onClick={() => setViewRound(r.round_number === live.round_number ? null : r.round_number)}
            >
              R{r.round_number} {done ? '✓' : ''}
            </button>
          );
        })}
        {browsing && (
          <button className="round-pill" style={{ borderColor: 'var(--err)', color: 'var(--err)' }} onClick={() => setViewRound(null)}>
            ● Back to live (R{live.round_number})
          </button>
        )}
      </div>

      {byeTeam && (
        <div className="bye-banner">
          <strong>
            {teamName(byeTeam.id)} {shownDone ? 'was' : 'is'} on the bye{shownDone ? '' : " — you're scoring!"}
          </strong>
          {!shownDone && (
            <span style={{ color: 'var(--muted)' }}>Split up: one iPad per court. Pick your court below.</span>
          )}
        </div>
      )}

      <div className="courts">
        {shown.matches.map((m: Match) => (
          <Link key={m.id} to={`/score/${m.id}`} className="court-card">
            <span className="court-num">{m.court}</span>
            <span className="tag">{statusDot(m.status)} Court {m.court} · {m.status}</span>
            <div className="vs">
              <span>{teamName(m.home_team_id)}</span>
              <span className="mid">vs</span>
              <span>{teamName(m.away_team_id)}</span>
            </div>
            <span className="tag" style={{ color: 'var(--amber)' }}>
              {m.status === 'final'
                ? `Final — ${m.winner_team_id ? teamName(m.winner_team_id) + ' won' : 'no winner set'}`
                : 'Tap to score this court →'}
            </span>
          </Link>
        ))}
      </div>

      <h2 className="page-title" style={{ fontSize: 26, margin: '32px 0 12px' }}>All rounds</h2>
      {data.rounds.map((r) => (
        <div key={r.round_number} className="panel" style={{ marginBottom: 10, display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            className="tag"
            style={{ minWidth: 70, background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', color: r === shown ? 'var(--amber)' : undefined }}
            onClick={() => setViewRound(r.round_number === live.round_number ? null : r.round_number)}
          >
            Round {r.round_number}
          </button>
          {r.matches.map((m) => (
            <Link key={m.id} to={`/score/${m.id}`} style={{ fontFamily: 'var(--display)', fontSize: 19 }}>
              {statusDot(m.status)} C{m.court}: {teamName(m.home_team_id)} vs {teamName(m.away_team_id)}
            </Link>
          ))}
          <span className="tag" style={{ marginLeft: 'auto' }}>
            Bye: {r.bye_team_id ? teamName(r.bye_team_id) : '—'}
          </span>
        </div>
      ))}
    </div>
  );
}
