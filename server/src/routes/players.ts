import { Router } from 'express';
import { z } from 'zod';
import type { DB } from '../db.js';

const createSchema = z.object({
  name: z.string().min(1),
  squad: z.enum(['varsity', 'jv', 'freshman']).nullish(),
});

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  squad: z.enum(['varsity', 'jv', 'freshman']).nullable().optional(),
  active: z.union([z.literal(0), z.literal(1)]).optional(),
});

export function playersRouter(db: DB): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json(db.prepare('SELECT * FROM players ORDER BY name').all());
  });

  router.post('/', (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    const { name, squad } = parsed.data;
    const info = db
      .prepare('INSERT INTO players (name, squad) VALUES (?, ?)')
      .run(name, squad ?? null);
    res.status(201).json(db.prepare('SELECT * FROM players WHERE id = ?').get(info.lastInsertRowid));
  });

  router.patch('/:id', (req, res) => {
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    const player = db.prepare('SELECT * FROM players WHERE id = ?').get(req.params.id);
    if (!player) return res.status(404).json({ error: 'player not found' });
    const fields = parsed.data;
    const sets: string[] = [];
    const values: unknown[] = [];
    for (const [key, value] of Object.entries(fields)) {
      sets.push(`${key} = ?`);
      values.push(value);
    }
    if (sets.length > 0) {
      db.prepare(`UPDATE players SET ${sets.join(', ')} WHERE id = ?`).run(...values, req.params.id);
    }
    res.json(db.prepare('SELECT * FROM players WHERE id = ?').get(req.params.id));
  });

  return router;
}
