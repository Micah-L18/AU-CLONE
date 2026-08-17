import { Router } from 'express';
import { z } from 'zod';
import type { DB } from '../db.js';
import { POSITIONS } from '../../../shared/types';

const positionSchema = z.enum(POSITIONS);

const createSchema = z.object({
  name: z.string().min(1),
  squad: z.enum(['varsity', 'jv', 'freshman']).nullish(),
  position: positionSchema.nullish(),
});

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  squad: z.enum(['varsity', 'jv', 'freshman']).nullable().optional(),
  position: positionSchema.nullable().optional(),
  active: z.union([z.literal(0), z.literal(1)]).optional(),
});

const importSchema = z.object({ csv: z.string().min(1) });

// Forgiving position spellings for CSV imports.
const POSITION_ALIASES: Record<string, (typeof POSITIONS)[number]> = {
  setter: 'Setter', s: 'Setter',
  outside: 'Outside', oh: 'Outside', 'outside hitter': 'Outside',
  opposite: 'Opposite', oppo: 'Opposite', opp: 'Opposite', 'right side': 'Opposite', rs: 'Opposite',
  middle: 'Middle', mb: 'Middle', 'middle blocker': 'Middle',
  lib: 'Lib', libero: 'Lib', l: 'Lib',
  ds: 'DS', 'defensive specialist': 'DS',
};

export function playersRouter(db: DB): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    res.json(db.prepare('SELECT * FROM players ORDER BY name').all());
  });

  router.post('/', (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    const { name, squad, position } = parsed.data;
    const info = db
      .prepare('INSERT INTO players (name, squad, position) VALUES (?, ?, ?)')
      .run(name, squad ?? null, position ?? null);
    res.status(201).json(db.prepare('SELECT * FROM players WHERE id = ?').get(info.lastInsertRowid));
  });

  // CSV roster import: one player per line as "first name, last name, position".
  // A header line is skipped, position spellings are normalized, players whose
  // full name already exists are skipped rather than duplicated.
  router.post('/import', (req, res) => {
    const parsed = importSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });

    const existing = new Set(
      (db.prepare('SELECT name FROM players').all() as { name: string }[]).map((p) =>
        p.name.trim().toLowerCase()
      )
    );
    const insert = db.prepare('INSERT INTO players (name, position) VALUES (?, ?)');

    const imported: string[] = [];
    const skipped: string[] = [];
    const errors: string[] = [];

    const lines = parsed.data.csv.split(/\r?\n/);
    const runImport = db.transaction(() => {
      lines.forEach((line, idx) => {
        const trimmed = line.trim();
        if (trimmed === '') return;
        const fields = trimmed.split(',').map((f) => f.trim().replace(/^"|"$/g, ''));
        // Header row: tolerate any column naming that mentions "name".
        if (idx === 0 && /name/i.test(trimmed) && !POSITION_ALIASES[fields[2]?.toLowerCase() ?? '']) {
          return;
        }
        const lineNo = idx + 1;
        const [first, last, rawPosition] = fields;
        if (!first || !last) {
          errors.push(`line ${lineNo}: expected "first name, last name, position"`);
          return;
        }
        let position: (typeof POSITIONS)[number] | null = null;
        if (rawPosition) {
          position = POSITION_ALIASES[rawPosition.toLowerCase()] ?? null;
          if (position === null) {
            errors.push(
              `line ${lineNo}: unknown position "${rawPosition}" (use ${POSITIONS.join(', ')})`
            );
            return;
          }
        }
        const name = `${first} ${last}`;
        if (existing.has(name.toLowerCase())) {
          skipped.push(name);
          return;
        }
        insert.run(name, position);
        existing.add(name.toLowerCase());
        imported.push(name);
      });
    });
    runImport();

    res.json({ imported: imported.length, names: imported, skipped, errors });
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
