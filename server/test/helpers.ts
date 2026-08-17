import { openDb, type DB } from '../src/db.js';
import { createApp } from '../src/app.js';
import request from 'supertest';
import type { Express } from 'express';

export interface TestContext {
  db: DB;
  app: Express;
}

export function makeApp(): TestContext {
  const db = openDb(':memory:');
  return { db, app: createApp(db) };
}

/** Create 45 players, a week with 5 teams of 9, and the generated schedule. */
export async function seedLeague(ctx: TestContext) {
  // Players go straight into the db — one HTTP round-trip per player makes
  // the suite slow and can flake supertest's per-request listeners.
  const insertPlayer = ctx.db.prepare('INSERT INTO players (name) VALUES (?)');
  const playerIds: number[] = [];
  for (let i = 1; i <= 45; i++) {
    const info = insertPlayer.run(`Player ${String(i).padStart(2, '0')}`);
    playerIds.push(Number(info.lastInsertRowid));
  }
  const weekRes = await request(ctx.app).post('/api/weeks').send({ week_number: 1, date: '2026-08-13' });
  const week = weekRes.body.week;
  const teams = weekRes.body.teams as { id: number; label: string }[];

  const draft = {
    teams: teams.map((t, ti) => ({
      week_team_id: t.id,
      captain_id: playerIds[ti * 9],
      player_ids: playerIds.slice(ti * 9, ti * 9 + 9),
    })),
  };
  await request(ctx.app).post(`/api/weeks/${week.id}/draft`).send(draft);
  const schedRes = await request(ctx.app).post(`/api/weeks/${week.id}/generate-schedule`).send();
  return { week, teams, playerIds, schedule: schedRes.body };
}
