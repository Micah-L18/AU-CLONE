import { Router } from 'express';
import { z } from 'zod';
import type { DB } from '../db.js';
import { CONTRIB_CTE } from './leaderboard.js';

const patchSchema = z.object({
  status: z.enum(['pending', 'live', 'final']).optional(),
  winner_team_id: z.number().int().nullable().optional(),
});

const scoreTapSchema = z.object({
  team_id: z.number().int(),
  delta: z.union([z.literal(1), z.literal(-1)]).optional(),
  client_id: z.string().min(1),
});

interface MatchRow {
  id: number;
  week_id: number;
  home_team_id: number;
  away_team_id: number;
  status: string;
  winner_team_id: number | null;
}

function teamWithRoster(db: DB, teamId: number) {
  const team = db.prepare('SELECT * FROM week_teams WHERE id = ?').get(teamId);
  const players = db
    .prepare(
      `SELECT p.* FROM rosters r JOIN players p ON p.id = r.player_id
       WHERE r.week_team_id = ? ORDER BY p.name`
    )
    .all(teamId);
  return { ...(team as object), players };
}

/**
 * Finalize bookkeeping for win bonuses: remove any prior win events for the
 * match, then award the current win-action points to every player on the
 * winning roster. Safe to re-run when the winner changes.
 */
export function applyWinBonus(db: DB, match: MatchRow, winnerTeamId: number | null): void {
  const winAction = db
    .prepare(`SELECT * FROM actions WHERE code = 'win'`)
    .get() as { id: number; points: number; team_points: number; active: number } | undefined;
  if (!winAction) return;

  db.prepare('DELETE FROM events WHERE match_id = ? AND action_id = ?').run(match.id, winAction.id);
  if (winnerTeamId === null || winAction.active !== 1) return;

  const roster = db
    .prepare('SELECT player_id FROM rosters WHERE week_team_id = ?')
    .all(winnerTeamId) as { player_id: number }[];
  const insert = db.prepare(
    `INSERT INTO events (match_id, player_id, action_id, points, team_points, device)
     VALUES (?, ?, ?, ?, ?, 'system')`
  );
  for (const r of roster) {
    insert.run(match.id, r.player_id, winAction.id, winAction.points, winAction.team_points);
  }
}

/** Mounted at /api/score-taps — undo for scoreboard points. */
export function scoreTapsRouter(db: DB): Router {
  const router = Router();
  router.delete('/:id', (req, res) => {
    const tap = db.prepare('SELECT * FROM score_taps WHERE id = ?').get(req.params.id);
    if (!tap) return res.status(404).json({ error: 'score tap not found' });
    db.prepare('DELETE FROM score_taps WHERE id = ?').run(req.params.id);
    res.json({ deleted: true });
  });
  return router;
}

export function matchesRouter(db: DB): Router {
  const router = Router();

  router.get('/:id', (req, res) => {
    const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(req.params.id) as
      | MatchRow
      | undefined;
    if (!match) return res.status(404).json({ error: 'match not found' });

    // Per-player totals inside this match: own player points + team points
    // credited from every teammate's events.
    const totals = db
      .prepare(
        `WITH ${CONTRIB_CTE}
         SELECT c.player_id, SUM(c.pts) AS total, SUM(c.own) AS event_count
         FROM contrib c
         WHERE c.match_id = ?
         GROUP BY c.player_id`
      )
      .all(match.id) as { player_id: number; total: number; event_count: number }[];

    // The rally score: manual +1 taps, independent of action points.
    const scoreFor = (teamId: number) => {
      const row = db
        .prepare(
          `SELECT COALESCE(SUM(delta), 0) AS score
           FROM score_taps WHERE match_id = ? AND team_id = ?`
        )
        .get(match.id, teamId) as { score: number };
      return row.score;
    };

    res.json({
      match,
      home: teamWithRoster(db, match.home_team_id),
      away: teamWithRoster(db, match.away_team_id),
      totals,
      home_score: scoreFor(match.home_team_id),
      away_score: scoreFor(match.away_team_id),
    });
  });

  // One rally point (idempotent on client_id, so offline retries are safe).
  router.post('/:id/score', (req, res) => {
    const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(req.params.id) as
      | MatchRow
      | undefined;
    if (!match) return res.status(404).json({ error: 'match not found' });
    const parsed = scoreTapSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    const { team_id, delta, client_id } = parsed.data;
    if (team_id !== match.home_team_id && team_id !== match.away_team_id) {
      return res.status(400).json({ error: 'team_id is not one of the match teams' });
    }
    const existing = db.prepare('SELECT * FROM score_taps WHERE client_id = ?').get(client_id);
    if (existing) return res.status(200).json(existing);
    const info = db
      .prepare('INSERT INTO score_taps (match_id, team_id, delta, client_id) VALUES (?, ?, ?, ?)')
      .run(match.id, team_id, delta ?? 1, client_id);
    res.status(201).json(db.prepare('SELECT * FROM score_taps WHERE id = ?').get(info.lastInsertRowid));
  });

  router.patch('/:id', (req, res) => {
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(req.params.id) as
      | MatchRow
      | undefined;
    if (!match) return res.status(404).json({ error: 'match not found' });

    const { status, winner_team_id } = parsed.data;
    if (winner_team_id !== undefined && winner_team_id !== null) {
      if (winner_team_id !== match.home_team_id && winner_team_id !== match.away_team_id) {
        return res.status(400).json({ error: 'winner_team_id is not one of the match teams' });
      }
    }

    const update = db.transaction(() => {
      if (status === 'live' && match.status === 'pending') {
        db.prepare(
          `UPDATE matches SET status = 'live', started_at = datetime('now') WHERE id = ?`
        ).run(match.id);
        db.prepare(
          `UPDATE weeks SET status = 'in_progress' WHERE id = ? AND status = 'scheduled'`
        ).run(match.week_id);
      } else if (status === 'pending') {
        // Re-open: clear timing, winner, and any win bonus already granted.
        db.prepare(
          `UPDATE matches SET status = 'pending', started_at = NULL, ended_at = NULL,
           winner_team_id = NULL WHERE id = ?`
        ).run(match.id);
        applyWinBonus(db, match, null);
      } else if (status === 'final') {
        const winner = winner_team_id !== undefined ? winner_team_id : match.winner_team_id;
        db.prepare(
          `UPDATE matches SET status = 'final', ended_at = datetime('now'), winner_team_id = ?
           WHERE id = ?`
        ).run(winner, match.id);
        applyWinBonus(db, match, winner);
        const remaining = db
          .prepare(`SELECT COUNT(*) AS n FROM matches WHERE week_id = ? AND status != 'final'`)
          .get(match.week_id) as { n: number };
        if (remaining.n === 0) {
          db.prepare(`UPDATE weeks SET status = 'complete' WHERE id = ?`).run(match.week_id);
        }
      } else if (winner_team_id !== undefined && match.status === 'final') {
        // Winner corrected after finalization.
        db.prepare('UPDATE matches SET winner_team_id = ? WHERE id = ?').run(
          winner_team_id,
          match.id
        );
        applyWinBonus(db, match, winner_team_id);
      }
    });
    update();
    res.json(db.prepare('SELECT * FROM matches WHERE id = ?').get(match.id));
  });

  return router;
}
