import { Router } from 'express';
import type { DB } from '../db.js';

export interface LeaderboardRow {
  player_id: number;
  name: string;
  total: number;
  weeks_played: number;
  avg_per_week: number;
}

/**
 * Every event contributes twice: the earner banks the action's player points,
 * and each roster teammate (not the earner) banks the action's team points.
 * Credits are derived at query time from the single events table — nothing
 * extra is stored, so undo stays one row.
 */
export const CONTRIB_CTE = `
  contrib AS (
    SELECT e.player_id AS player_id, m.week_id, e.match_id, e.points AS pts, 1 AS own
    FROM events e
    JOIN matches m ON m.id = e.match_id
    UNION ALL
    SELECT r2.player_id, m.week_id, e.match_id, e.team_points, 0
    FROM events e
    JOIN matches m ON m.id = e.match_id
    JOIN rosters r1 ON r1.player_id = e.player_id
      AND r1.week_team_id IN (m.home_team_id, m.away_team_id)
    JOIN rosters r2 ON r2.week_team_id = r1.week_team_id AND r2.player_id <> e.player_id
    WHERE e.team_points <> 0
  )
`;

export function seasonLeaderboard(db: DB): LeaderboardRow[] {
  return db
    .prepare(
      `WITH ${CONTRIB_CTE}
       SELECT p.id AS player_id, p.name,
              COALESCE(SUM(c.pts), 0) AS total,
              COUNT(DISTINCT c.week_id) AS weeks_played,
              ROUND(COALESCE(SUM(c.pts), 0) * 1.0 / MAX(COUNT(DISTINCT c.week_id), 1), 2)
                AS avg_per_week
       FROM contrib c
       JOIN players p ON p.id = c.player_id
       GROUP BY p.id
       ORDER BY total DESC, p.name`
    )
    .all() as LeaderboardRow[];
}

export function weekLeaderboard(db: DB, weekId: number): LeaderboardRow[] {
  return db
    .prepare(
      `WITH ${CONTRIB_CTE}
       SELECT p.id AS player_id, p.name,
              COALESCE(SUM(c.pts), 0) AS total,
              1 AS weeks_played,
              COALESCE(SUM(c.pts), 0) AS avg_per_week
       FROM contrib c
       JOIN players p ON p.id = c.player_id
       WHERE c.week_id = ?
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
        `WITH ${CONTRIB_CTE},
         weekly AS (
           SELECT c.player_id, c.week_id, SUM(c.pts) AS total
           FROM contrib c
           GROUP BY c.player_id, c.week_id
         )
         SELECT p.id AS player_id, p.name, weekly.week_id, w.week_number, weekly.total
         FROM weekly
         JOIN players p ON p.id = weekly.player_id
         JOIN weeks w ON w.id = weekly.week_id
         ORDER BY weekly.total DESC
         LIMIT 1`
      )
      .get() ?? null;

    const bestAverage =
      [...season].sort((a, b) => b.avg_per_week - a.avg_per_week)[0] ?? null;

    res.json({ champion, single_week_high: singleWeekHigh, best_average: bestAverage });
  });

  return router;
}
