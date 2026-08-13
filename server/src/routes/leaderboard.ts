import { Router } from 'express';
import type { DB } from '../db.js';

export interface LeaderboardRow {
  player_id: number;
  name: string;
  total: number;
  weeks_played: number;
  avg_per_week: number;
}

export function seasonLeaderboard(db: DB): LeaderboardRow[] {
  return db
    .prepare(
      `SELECT p.id AS player_id, p.name,
              COALESCE(SUM(e.points), 0) AS total,
              COUNT(DISTINCT m.week_id) AS weeks_played,
              ROUND(COALESCE(SUM(e.points), 0) * 1.0 / MAX(COUNT(DISTINCT m.week_id), 1), 2)
                AS avg_per_week
       FROM events e
       JOIN players p ON p.id = e.player_id
       JOIN matches m ON m.id = e.match_id
       GROUP BY p.id
       ORDER BY total DESC, p.name`
    )
    .all() as LeaderboardRow[];
}

export function weekLeaderboard(db: DB, weekId: number): LeaderboardRow[] {
  return db
    .prepare(
      `SELECT p.id AS player_id, p.name,
              COALESCE(SUM(e.points), 0) AS total,
              1 AS weeks_played,
              COALESCE(SUM(e.points), 0) AS avg_per_week
       FROM events e
       JOIN players p ON p.id = e.player_id
       JOIN matches m ON m.id = e.match_id
       WHERE m.week_id = ?
       GROUP BY p.id
       ORDER BY total DESC, p.name`
    )
    .all(weekId) as LeaderboardRow[];
}

export function leaderboardRouter(db: DB): Router {
  const router = Router();

  router.get('/', (req, res) => {
    const scope = (req.query.scope as string) ?? 'season';
    if (scope === 'week') {
      const weekId = Number(req.query.week_id);
      if (!Number.isInteger(weekId)) {
        return res.status(400).json({ error: 'week_id required for scope=week' });
      }
      return res.json(weekLeaderboard(db, weekId));
    }
    res.json(seasonLeaderboard(db));
  });

  return router;
}

export function awardsRouter(db: DB): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    const season = seasonLeaderboard(db);
    const champion = season[0] ?? null;

    const singleWeekHigh = db
      .prepare(
        `SELECT p.id AS player_id, p.name, m.week_id, w.week_number,
                SUM(e.points) AS total
         FROM events e
         JOIN players p ON p.id = e.player_id
         JOIN matches m ON m.id = e.match_id
         JOIN weeks w ON w.id = m.week_id
         GROUP BY p.id, m.week_id
         ORDER BY total DESC
         LIMIT 1`
      )
      .get() ?? null;

    const bestAverage =
      [...season].sort((a, b) => b.avg_per_week - a.avg_per_week)[0] ?? null;

    res.json({ champion, single_week_high: singleWeekHigh, best_average: bestAverage });
  });

  return router;
}
