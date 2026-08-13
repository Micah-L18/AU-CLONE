import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { usePolling } from '../hooks/usePolling';
import type { Match, WeekMatchesResponse } from '@shared/types';

function statusDot(status: string) {
  return <span className={`status-dot status-${status === 'live' ? 'live' : status === 'final' ? 'final' : 'pending'}`} />;
}

export default function RoundControl() {
  const { data, error } = usePolling<WeekMatchesResponse | null>(async () => {
    const week = await api.currentWeek().catch(() => null);
    if (!week) return null;
    return api.weekMatches(week.id);
  }, 3000);

  if (error && !data) return <div className="page"><div className="empty"><b>Can't reach the server</b>{error}</div></div>;
  if (!data) return <div className="page"><div className="empty"><b>No week yet</b>Create a week in Admin, run the draft, and generate the schedule.</div></div>;
  if (data.rounds.length === 0) {
    return (
      <div className="page">
        <h1 className="page-title">Week {data.week.week_number}</h1>
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

  // Current round: first round with an unfinished match, else the last.
  const current =
    data.rounds.find((r) => r.matches.some((m) => m.status !== 'final')) ??
    data.rounds[data.rounds.length - 1];
  const byeTeam = current.bye_team_id ? teamById.get(current.bye_team_id) : null;

  return (
    <div className="page">
      <h1 className="page-title">Week {data.week.week_number} — Round {current.round_number}</h1>
      <p className="page-sub">{data.week.date} · {data.week.status.replace('_', ' ')}</p>

      <div className="round-strip">
        {data.rounds.map((r) => {
          const done = r.matches.every((m) => m.status === 'final');
          return (
            <span key={r.round_number} className={`round-pill ${r === current ? 'current' : done ? 'done' : ''}`}>
              R{r.round_number} {done ? '✓' : ''}
            </span>
          );
        })}
      </div>

      {byeTeam && (
        <div className="bye-banner">
          <strong>{teamName(byeTeam.id)} is on the bye — you're scoring!</strong>
          <span style={{ color: 'var(--muted)' }}>Split up: one iPad per court. Pick your court below.</span>
        </div>
      )}

      <div className="courts">
        {current.matches.map((m: Match) => (
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
          <span className="tag" style={{ minWidth: 70 }}>Round {r.round_number}</span>
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
