PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS players (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  squad       TEXT,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS weeks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  week_number INTEGER NOT NULL,
  date        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'draft'
              CHECK (status IN ('draft','scheduled','in_progress','complete'))
);

CREATE TABLE IF NOT EXISTS week_teams (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  week_id     INTEGER NOT NULL REFERENCES weeks(id) ON DELETE CASCADE,
  label       TEXT NOT NULL,
  captain_id  INTEGER REFERENCES players(id),
  UNIQUE (week_id, label)
);

CREATE TABLE IF NOT EXISTS rosters (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  week_team_id INTEGER NOT NULL REFERENCES week_teams(id) ON DELETE CASCADE,
  player_id    INTEGER NOT NULL REFERENCES players(id),
  UNIQUE (week_team_id, player_id)
);

CREATE TABLE IF NOT EXISTS matches (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  week_id        INTEGER NOT NULL REFERENCES weeks(id) ON DELETE CASCADE,
  round_number   INTEGER NOT NULL,
  court          INTEGER NOT NULL,
  home_team_id   INTEGER NOT NULL REFERENCES week_teams(id),
  away_team_id   INTEGER NOT NULL REFERENCES week_teams(id),
  status         TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','live','final')),
  winner_team_id INTEGER REFERENCES week_teams(id),
  started_at     TEXT,
  ended_at       TEXT,
  UNIQUE (week_id, round_number, court)
);

CREATE TABLE IF NOT EXISTS actions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  code       TEXT NOT NULL UNIQUE,
  label      TEXT NOT NULL,
  points     REAL NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active     INTEGER NOT NULL DEFAULT 1,
  system     INTEGER NOT NULL DEFAULT 0
);

-- The source of truth for ALL scoring. points is a snapshot of
-- actions.points at insert time so retuning never rewrites history.
CREATE TABLE IF NOT EXISTS events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id   INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  player_id  INTEGER NOT NULL REFERENCES players(id),
  action_id  INTEGER NOT NULL REFERENCES actions(id),
  points     REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  device     TEXT,
  client_id  TEXT UNIQUE
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_match  ON events(match_id);
CREATE INDEX IF NOT EXISTS idx_events_player ON events(player_id);
CREATE INDEX IF NOT EXISTS idx_rosters_team  ON rosters(week_team_id);
CREATE INDEX IF NOT EXISTS idx_matches_week  ON matches(week_id);
