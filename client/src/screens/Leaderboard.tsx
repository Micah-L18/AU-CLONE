import { useState } from 'react';
import type { AwardsResponse, LeaderboardRow, Week } from '@shared/types';
import { api } from '../api/client';
import { usePolling } from '../hooks/usePolling';

type SortKey = 'name' | 'total' | 'weeks_played' | 'avg_per_week';

export default function Leaderboard() {
  const [scope, setScope] = useState<'season' | 'week'>('season');
  const [weekId, setWeekId] = useState<number | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'total', dir: 'desc' });

  const { data: weeks } = usePolling<Week[]>(() => api.weeks(), 30_000);
  const { data: rows } = usePolling<LeaderboardRow[]>(
    () => api.leaderboard(scope, weekId ?? undefined),
    4000,
    [scope, weekId]
  );
  const { data: awards } = usePolling<AwardsResponse>(() => api.awards(), 8000);

  // Clicking the active column flips direction; a new column starts with its
  // natural direction (A→Z for names, high→low for numbers).
  const toggleSort = (key: SortKey) =>
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' }
        : { key, dir: key === 'name' ? 'asc' : 'desc' }
    );

  const arrow = (key: SortKey) => (sort.key === key ? (sort.dir === 'desc' ? ' ▾' : ' ▴') : '');

  const sorted = [...(rows ?? [])].sort((a, b) => {
    const cmp = sort.key === 'name' ? a.name.localeCompare(b.name) : a[sort.key] - b[sort.key];
    return sort.dir === 'asc' ? cmp : -cmp;
  });

  return (
    <div className="page">
      <h1 className="page-title">Leaderboard</h1>
      <p className="page-sub">Every point follows the player — teams reshuffle, totals don't.</p>

      {awards && scope === 'season' && (
        <div className="awards">
          <div className="award">
            <span className="tag">🏆 League champion (so far)</span>
            <div className="who">{awards.champion?.name ?? '—'}</div>
            <div className="how">{awards.champion ? `${awards.champion.total} season points` : 'no points yet'}</div>
          </div>
          <div className="award">
            <span className="tag">🔥 Single-week high</span>
            <div className="who">{awards.single_week_high?.name ?? '—'}</div>
            <div className="how">
              {awards.single_week_high
                ? `${awards.single_week_high.total} pts in week ${awards.single_week_high.week_number}`
                : 'no points yet'}
            </div>
          </div>
          <div className="award">
            <span className="tag">📈 Best weekly average</span>
            <div className="who">{awards.best_average?.name ?? '—'}</div>
            <div className="how">{awards.best_average ? `${awards.best_average.avg_per_week} pts/week` : 'no points yet'}</div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <button className={`btn ${scope === 'season' ? 'btn-amber' : 'btn-ghost'}`} onClick={() => setScope('season')}>
          Season
        </button>
        {(weeks ?? []).map((w) => (
          <button
            key={w.id}
            className={`btn ${scope === 'week' && weekId === w.id ? 'btn-amber' : 'btn-ghost'}`}
            onClick={() => { setScope('week'); setWeekId(w.id); }}
          >
            Wk {w.week_number}
          </button>
        ))}
      </div>

      <div className="panel">
        <table className="lb-table">
          <thead>
            <tr>
              <th>#</th>
              <th onClick={() => toggleSort('name')}>Player{arrow('name')}</th>
              <th onClick={() => toggleSort('total')}>Points{arrow('total')}</th>
              <th onClick={() => toggleSort('weeks_played')}>Weeks{arrow('weeks_played')}</th>
              <th onClick={() => toggleSort('avg_per_week')}>Avg/Wk{arrow('avg_per_week')}</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, i) => (
              <tr key={r.player_id}>
                <td className="rank">{i + 1}</td>
                <td>{r.name}</td>
                <td className="num">{r.total}</td>
                <td className="num" style={{ color: 'var(--muted)' }}>{r.weeks_played}</td>
                <td className="num">{r.avg_per_week}</td>
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr><td colSpan={5} style={{ color: 'var(--muted)', padding: 30, textAlign: 'center' }}>
                No points recorded {scope === 'week' ? 'this week' : 'yet'}.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
