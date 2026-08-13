import { Router } from 'express';
import { z } from 'zod';
import type { DB } from '../db.js';
import { generateMatchSpecs, TEAM_LABELS } from '../schedule.js';

const createSchema = z.object({
  week_number: z.number().int().positive(),
  date: z.string().min(1),
});

const draftSchema = z.object({
  teams: z
    .array(
      z.object({
        week_team_id: z.number().int(),
        captain_id: z.number().int().nullable(),
        player_ids: z.array(z.number().int()),
      })
    )
    .length(5),
});

const patchSchema = z.object({
  status: z.enum(['draft', 'scheduled', 'in_progress', 'complete']).optional(),
  date: z.string().min(1).optional(),
});

interface TeamRow {
  id: number;
  week_id: number;
  label: string;
  captain_id: number | null;
}

function teamsWithRosters(db: DB, weekId: number) {
  const teams = db
    .prepare('SELECT * FROM week_teams WHERE week_id = ? ORDER BY label')
    .all(weekId) as TeamRow[];
  const rosterStmt = db.prepare(
    `SELECT p.* FROM rosters r JOIN players p ON p.id = r.player_id
     WHERE r.week_team_id = ? ORDER BY p.name`
  );
  return teams.map((t) => ({ ...t, players: rosterStmt.all(t.id) }));
}

export function weeksRouter(db: DB): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json(db.prepare('SELECT * FROM weeks ORDER BY week_number').all());
  });

  router.get('/current', (_req, res) => {
    // The most relevant week: an in-progress one, else the latest non-complete,
    // else the latest overall.
    const week =
      db.prepare(`SELECT * FROM weeks WHERE status = 'in_progress' ORDER BY week_number DESC LIMIT 1`).get() ??
      db.prepare(`SELECT * FROM weeks WHERE status != 'complete' ORDER BY week_number DESC LIMIT 1`).get() ??
      db.prepare('SELECT * FROM weeks ORDER BY week_number DESC LIMIT 1').get();
    if (!week) return res.status(404).json({ error: 'no weeks exist yet' });
    res.json(week);
  });

  router.post('/', (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    const { week_number, date } = parsed.data;
    const createWeek = db.transaction(() => {
      const info = db
        .prepare(`INSERT INTO weeks (week_number, date, status) VALUES (?, ?, 'draft')`)
        .run(week_number, date);
      const weekId = Number(info.lastInsertRowid);
      const insertTeam = db.prepare('INSERT INTO week_teams (week_id, label) VALUES (?, ?)');
      for (const label of TEAM_LABELS) insertTeam.run(weekId, label);
      return weekId;
    });
    const weekId = createWeek();
    res.status(201).json({
      week: db.prepare('SELECT * FROM weeks WHERE id = ?').get(weekId),
      teams: teamsWithRosters(db, weekId),
    });
  });

  router.post('/:id/draft', (req, res) => {
    const week = db.prepare('SELECT * FROM weeks WHERE id = ?').get(req.params.id) as
      | { id: number }
      | undefined;
    if (!week) return res.status(404).json({ error: 'week not found' });
    const parsed = draftSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });

    const teamIds = (db
      .prepare('SELECT id FROM week_teams WHERE week_id = ?')
      .all(week.id) as { id: number }[]).map((t) => t.id);
    for (const t of parsed.data.teams) {
      if (!teamIds.includes(t.week_team_id)) {
        return res.status(400).json({ error: `week_team ${t.week_team_id} not in week ${week.id}` });
      }
    }
    const allPlayerIds = parsed.data.teams.flatMap((t) => t.player_ids);
    if (new Set(allPlayerIds).size !== allPlayerIds.length) {
      return res.status(400).json({ error: 'a player appears on more than one team' });
    }

    const applyDraft = db.transaction(() => {
      const clear = db.prepare('DELETE FROM rosters WHERE week_team_id = ?');
      const insert = db.prepare('INSERT INTO rosters (week_team_id, player_id) VALUES (?, ?)');
      const setCaptain = db.prepare('UPDATE week_teams SET captain_id = ? WHERE id = ?');
      for (const t of parsed.data.teams) {
        clear.run(t.week_team_id);
        setCaptain.run(t.captain_id, t.week_team_id);
        for (const pid of t.player_ids) insert.run(t.week_team_id, pid);
      }
    });
    applyDraft();
    res.json({ week, teams: teamsWithRosters(db, week.id) });
  });

  router.post('/:id/generate-schedule', (req, res) => {
    const week = db.prepare('SELECT * FROM weeks WHERE id = ?').get(req.params.id) as
      | { id: number }
      | undefined;
    if (!week) return res.status(404).json({ error: 'week not found' });
    const existing = db
      .prepare('SELECT COUNT(*) AS n FROM matches WHERE week_id = ?')
      .get(week.id) as { n: number };
    if (existing.n > 0) {
      return res.status(409).json({ error: 'schedule already generated for this week' });
    }
    const teams = db
      .prepare('SELECT id, label FROM week_teams WHERE week_id = ?')
      .all(week.id) as { id: number; label: string }[];
    const byLabel = new Map(teams.map((t) => [t.label, t.id]));

    const generate = db.transaction(() => {
      const insert = db.prepare(
        `INSERT INTO matches (week_id, round_number, court, home_team_id, away_team_id)
         VALUES (?, ?, ?, ?, ?)`
      );
      for (const spec of generateMatchSpecs()) {
        insert.run(
          week.id,
          spec.round_number,
          spec.court,
          byLabel.get(spec.home_label),
          byLabel.get(spec.away_label)
        );
      }
      db.prepare(`UPDATE weeks SET status = 'scheduled' WHERE id = ? AND status = 'draft'`).run(week.id);
    });
    generate();
    res.status(201).json(buildWeekMatches(db, week.id));
  });

  router.patch('/:id', (req, res) => {
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    const week = db.prepare('SELECT * FROM weeks WHERE id = ?').get(req.params.id);
    if (!week) return res.status(404).json({ error: 'week not found' });
    const sets: string[] = [];
    const values: unknown[] = [];
    for (const [key, value] of Object.entries(parsed.data)) {
      sets.push(`${key} = ?`);
      values.push(value);
    }
    if (sets.length > 0) {
      db.prepare(`UPDATE weeks SET ${sets.join(', ')} WHERE id = ?`).run(...values, req.params.id);
    }
    res.json(db.prepare('SELECT * FROM weeks WHERE id = ?').get(req.params.id));
  });

  // Removing a week takes its schedule AND its recorded points with it —
  // the ?dry_run=1 form only reports what would be destroyed so the client
  // can confirm first.
  router.delete('/:id', (req, res) => {
    const week = db.prepare('SELECT * FROM weeks WHERE id = ?').get(req.params.id) as
      | { id: number }
      | undefined;
    if (!week) return res.status(404).json({ error: 'week not found' });

    const counts = db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM matches WHERE week_id = ?) AS matches,
           (SELECT COUNT(*) FROM events e JOIN matches m ON m.id = e.match_id
             WHERE m.week_id = ?) AS events`
      )
      .get(week.id, week.id) as { matches: number; events: number };

    if (req.query.dry_run === '1') {
      return res.json({ deleted: false, ...counts });
    }

    // Matches go first so their team references never dangle; events cascade
    // from matches, rosters cascade from week_teams.
    const removeWeek = db.transaction(() => {
      db.prepare('DELETE FROM matches WHERE week_id = ?').run(week.id);
      db.prepare('DELETE FROM week_teams WHERE week_id = ?').run(week.id);
      db.prepare('DELETE FROM weeks WHERE id = ?').run(week.id);
    });
    removeWeek();
    res.json({ deleted: true, ...counts });
  });

  router.get('/:id/matches', (req, res) => {
    const week = db.prepare('SELECT * FROM weeks WHERE id = ?').get(req.params.id) as
      | { id: number }
      | undefined;
    if (!week) return res.status(404).json({ error: 'week not found' });
    res.json(buildWeekMatches(db, week.id));
  });

  return router;
}

export function buildWeekMatches(db: DB, weekId: number) {
  const week = db.prepare('SELECT * FROM weeks WHERE id = ?').get(weekId);
  const teams = teamsWithRosters(db, weekId);
  const matches = db
    .prepare('SELECT * FROM matches WHERE week_id = ? ORDER BY round_number, court')
    .all(weekId) as { round_number: number; home_team_id: number; away_team_id: number }[];
  const allTeamIds = teams.map((t) => t.id);
  const rounds: { round_number: number; matches: unknown[]; bye_team_id: number | null }[] = [];
  for (const m of matches) {
    let round = rounds.find((r) => r.round_number === m.round_number);
    if (!round) {
      round = { round_number: m.round_number, matches: [], bye_team_id: null };
      rounds.push(round);
    }
    round.matches.push(m);
  }
  // The bye team is simply the one not playing that round — derived, never stored.
  for (const round of rounds) {
    const playing = new Set(
      (round.matches as { home_team_id: number; away_team_id: number }[]).flatMap((m) => [
        m.home_team_id,
        m.away_team_id,
      ])
    );
    round.bye_team_id = allTeamIds.find((id) => !playing.has(id)) ?? null;
  }
  return { week, teams, rounds };
}
