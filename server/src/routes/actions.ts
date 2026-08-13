import { Router } from 'express';
import { z } from 'zod';
import type { DB } from '../db.js';

const createSchema = z.object({
  code: z.string().min(1).regex(/^[a-z0-9_]+$/, 'code must be lowercase snake_case'),
  label: z.string().min(1),
  points: z.number(),
  sort_order: z.number().int().optional(),
  active: z.union([z.literal(0), z.literal(1)]).optional(),
});

const patchSchema = z.object({
  label: z.string().min(1).optional(),
  points: z.number().optional(),
  sort_order: z.number().int().optional(),
  active: z.union([z.literal(0), z.literal(1)]).optional(),
});

export function actionsRouter(db: DB): Router {
  const router = Router();

  router.get('/', (req, res) => {
    const includeInactive = req.query.all === '1';
    const rows = includeInactive
      ? db.prepare('SELECT * FROM actions ORDER BY sort_order, id').all()
      : db.prepare('SELECT * FROM actions WHERE active = 1 ORDER BY sort_order, id').all();
    res.json(rows);
  });

  router.post('/', (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    const { code, label, points, sort_order, active } = parsed.data;
    const exists = db.prepare('SELECT id FROM actions WHERE code = ?').get(code);
    if (exists) return res.status(409).json({ error: `action code '${code}' already exists` });
    const info = db
      .prepare('INSERT INTO actions (code, label, points, sort_order, active) VALUES (?, ?, ?, ?, ?)')
      .run(code, label, points, sort_order ?? 50, active ?? 1);
    res.status(201).json(db.prepare('SELECT * FROM actions WHERE id = ?').get(info.lastInsertRowid));
  });

  router.put('/:id', (req, res) => {
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    const action = db.prepare('SELECT * FROM actions WHERE id = ?').get(req.params.id);
    if (!action) return res.status(404).json({ error: 'action not found' });
    const sets: string[] = [];
    const values: unknown[] = [];
    for (const [key, value] of Object.entries(parsed.data)) {
      sets.push(`${key} = ?`);
      values.push(value);
    }
    if (sets.length > 0) {
      db.prepare(`UPDATE actions SET ${sets.join(', ')} WHERE id = ?`).run(...values, req.params.id);
    }
    res.json(db.prepare('SELECT * FROM actions WHERE id = ?').get(req.params.id));
  });

  router.delete('/:id', (req, res) => {
    const action = db.prepare('SELECT * FROM actions WHERE id = ?').get(req.params.id) as
      | { id: number; system: number }
      | undefined;
    if (!action) return res.status(404).json({ error: 'action not found' });
    if (action.system === 1) {
      return res.status(400).json({ error: 'built-in actions cannot be deleted; deactivate instead' });
    }
    const used = db.prepare('SELECT 1 FROM events WHERE action_id = ? LIMIT 1').get(action.id);
    if (used) {
      // Soft-delete: events reference it, so keep the row for history.
      db.prepare('UPDATE actions SET active = 0 WHERE id = ?').run(action.id);
      return res.json({ soft_deleted: true });
    }
    db.prepare('DELETE FROM actions WHERE id = ?').run(action.id);
    res.json({ deleted: true });
  });

  return router;
}
