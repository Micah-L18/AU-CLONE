import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export type DB = Database.Database;

const SCHEMA = readFileSync(join(__dirname, 'schema.sql'), 'utf8');

export const DEFAULT_ACTIONS = [
  { code: 'kill', label: 'Kill', points: 8, team_points: 2, sort_order: 1, system: 0 },
  { code: 'ace', label: 'Ace', points: 12, team_points: 3, sort_order: 2, system: 0 },
  { code: 'block', label: 'Block', points: 10, team_points: 2, sort_order: 3, system: 0 },
  { code: 'dig', label: 'Dig', points: 5, team_points: 1, sort_order: 4, system: 0 },
  { code: 'pass', label: 'Pass', points: 3, team_points: 1, sort_order: 5, system: 0 },
  { code: 'assist', label: 'Assist', points: 4, team_points: 1, sort_order: 6, system: 0 },
  { code: 'hit_err', label: 'Hitting Error', points: -3, team_points: -1, sort_order: 7, system: 0 },
  { code: 'win', label: 'Match Win', points: 25, team_points: 0, sort_order: 100, system: 1 },
];

export const DEFAULT_SETTINGS: Record<string, string> = {
  set_duration_minutes: '20',
};

/** Idempotently insert built-in actions and settings (existing rows untouched). */
export function ensureDefaults(db: DB): void {
  const insertAction = db.prepare(
    `INSERT OR IGNORE INTO actions (code, label, points, team_points, sort_order, system)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  for (const a of DEFAULT_ACTIONS) {
    insertAction.run(a.code, a.label, a.points, a.team_points, a.sort_order, a.system);
  }
  const insertSetting = db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`);
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    insertSetting.run(key, value);
  }
}

/** Additive migrations for databases created before a column existed. */
function migrate(db: DB): void {
  const playerCols = (db.prepare('PRAGMA table_info(players)').all() as { name: string }[]).map(
    (c) => c.name
  );
  if (!playerCols.includes('position')) {
    db.exec('ALTER TABLE players ADD COLUMN position TEXT');
  }

  const actionCols = (db.prepare('PRAGMA table_info(actions)').all() as { name: string }[]).map(
    (c) => c.name
  );
  if (!actionCols.includes('team_points')) {
    db.exec('ALTER TABLE actions ADD COLUMN team_points REAL NOT NULL DEFAULT 0');
    // Give the built-in actions their default team values on upgrade.
    const setTeam = db.prepare('UPDATE actions SET team_points = ? WHERE code = ?');
    for (const a of DEFAULT_ACTIONS) setTeam.run(a.team_points, a.code);
  }

  const eventCols = (db.prepare('PRAGMA table_info(events)').all() as { name: string }[]).map(
    (c) => c.name
  );
  if (!eventCols.includes('team_points')) {
    db.exec('ALTER TABLE events ADD COLUMN team_points REAL NOT NULL DEFAULT 0');
    // Backfill history from each event's action so past match scores make sense.
    db.exec(
      `UPDATE events SET team_points =
         COALESCE((SELECT a.team_points FROM actions a WHERE a.id = events.action_id), 0)`
    );
  }
}

export function openDb(path?: string): DB {
  const dbPath = path ?? process.env.DB_PATH ?? join(__dirname, '..', 'league.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  migrate(db);
  ensureDefaults(db);
  return db;
}
