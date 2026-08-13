import { Router } from 'express';
import { z } from 'zod';
import type { DB } from '../db.js';

const createSchema = z.object({
  player_id: z.number().int(),
  action_id: z.number().int(),
  client_id: z.string().min(1),
  device: z.string().optional(),
});

/** Routes mounted at /api/matches/:matchId/events */
export function matchEventsRouter(db: DB): Router {
  const router = Router({ mergeParams: true });

  router.get('/', (req, res) => {
    const { matchId } = req.params as { matchId: string };
    res.json(
      db.prepare('SELECT * FROM events WHERE match_id = ? ORDER BY id').all(matchId)
    );
  });

  // The hot path: one tap = one event. points snapshots actions.points so
  // retuning point values never rewrites past results. client_id makes offline
  // retries idempotent.
  router.post('/', (req, res) => {
    const { matchId } = req.params as { matchId: string };
    const match = db.prepare('SELECT * FROM matches WHERE id = ?').get(matchId) as
      | { id: number; status: string }
      | undefined;
    if (!match) return res.status(404).json({ error: 'match not found' });
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    const { player_id, action_id, client_id, device } = parsed.data;

    const existing = db.prepare('SELECT * FROM events WHERE client_id = ?').get(client_id);
    if (existing) return res.status(200).json(existing);

    const action = db.prepare('SELECT * FROM actions WHERE id = ?').get(action_id) as
      | { id: number; points: number; active: number }
      | undefined;
    if (!action) return res.status(400).json({ error: 'unknown action' });
    if (action.active !== 1) return res.status(400).json({ error: 'action is inactive' });
    const player = db.prepare('SELECT id FROM players WHERE id = ?').get(player_id);
    if (!player) return res.status(400).json({ error: 'unknown player' });

    const info = db
      .prepare(
        `INSERT INTO events (match_id, player_id, action_id, points, device, client_id)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(match.id, player_id, action.id, action.points, device ?? null, client_id);
    res.status(201).json(db.prepare('SELECT * FROM events WHERE id = ?').get(info.lastInsertRowid));
  });

  return router;
}

/** Routes mounted at /api/events */
export function eventsRouter(db: DB): Router {
  const router = Router();

  // Undo a single tap.
  router.delete('/:id', (req, res) => {
    const event = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
    if (!event) return res.status(404).json({ error: 'event not found' });
    db.prepare('DELETE FROM events WHERE id = ?').run(req.params.id);
    res.json({ deleted: true });
  });

  return router;
}
