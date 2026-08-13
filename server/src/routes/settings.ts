import { Router } from 'express';
import { z } from 'zod';
import type { DB } from '../db.js';

const putSchema = z.record(z.string(), z.string());

export function settingsRouter(db: DB): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    const rows = db.prepare('SELECT key, value FROM settings').all() as {
      key: string;
      value: string;
    }[];
    res.json(Object.fromEntries(rows.map((r) => [r.key, r.value])));
  });

  router.put('/', (req, res) => {
    const parsed = putSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    const upsert = db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    );
    const writeAll = db.transaction((entries: [string, string][]) => {
      for (const [key, value] of entries) upsert.run(key, value);
    });
    writeAll(Object.entries(parsed.data));
    const rows = db.prepare('SELECT key, value FROM settings').all() as {
      key: string;
      value: string;
    }[];
    res.json(Object.fromEntries(rows.map((r) => [r.key, r.value])));
  });

  return router;
}
