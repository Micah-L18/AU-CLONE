import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { ROUND_PATTERN, generateMatchSpecs, TEAM_LABELS } from '../src/schedule.js';
import { makeApp, seedLeague } from './helpers.js';

describe('round-robin pattern', () => {
  it('covers all 10 pairings exactly once', () => {
    const pairings = generateMatchSpecs().map((m) =>
      [m.home_label, m.away_label].sort().join('')
    );
    expect(pairings).toHaveLength(10);
    expect(new Set(pairings).size).toBe(10);
    const expected = new Set<string>();
    for (let i = 0; i < TEAM_LABELS.length; i++) {
      for (let j = i + 1; j < TEAM_LABELS.length; j++) {
        expected.add(TEAM_LABELS[i] + TEAM_LABELS[j]);
      }
    }
    expect(new Set(pairings)).toEqual(expected);
  });

  it('gives every team exactly one bye, never while playing', () => {
    const byes = ROUND_PATTERN.map((r) => r.bye);
    expect(new Set(byes).size).toBe(5);
    for (const r of ROUND_PATTERN) {
      const playing = [...r.court1, ...r.court2];
      expect(playing).not.toContain(r.bye);
      expect(new Set(playing).size).toBe(4);
    }
  });

  it('has two courts in each of the five rounds', () => {
    const specs = generateMatchSpecs();
    for (let round = 1; round <= 5; round++) {
      const courts = specs.filter((s) => s.round_number === round).map((s) => s.court);
      expect(courts.sort()).toEqual([1, 2]);
    }
  });
});

describe('schedule generation API', () => {
  it('creates 10 matches and derives the bye team per round', async () => {
    const ctx = makeApp();
    const { schedule } = await seedLeague(ctx);
    expect(schedule.rounds).toHaveLength(5);
    const teamById = new Map(
      (schedule.teams as { id: number; label: string }[]).map((t) => [t.id, t.label])
    );
    const byeLabels = schedule.rounds.map(
      (r: { bye_team_id: number }) => teamById.get(r.bye_team_id)
    );
    expect(byeLabels).toEqual(['A', 'D', 'B', 'E', 'C']);
  });

  it('deletes a week along with its teams, matches, and events', async () => {
    const ctx = makeApp();
    const { week, schedule, playerIds } = await seedLeague(ctx);
    const match = schedule.rounds[0].matches[0];
    const actions = (await request(ctx.app).get('/api/actions')).body as { id: number; code: string }[];
    const kill = actions.find((a) => a.code === 'kill')!;
    await request(ctx.app)
      .post(`/api/matches/${match.id}/events`)
      .send({ player_id: playerIds[9], action_id: kill.id, client_id: 'del-1' });

    // Dry run reports the blast radius without deleting anything.
    const preview = await request(ctx.app).delete(`/api/weeks/${week.id}?dry_run=1`);
    expect(preview.body).toEqual({ deleted: false, matches: 10, events: 1 });
    expect((await request(ctx.app).get('/api/weeks')).body).toHaveLength(1);

    const res = await request(ctx.app).delete(`/api/weeks/${week.id}`);
    expect(res.body).toEqual({ deleted: true, matches: 10, events: 1 });
    expect((await request(ctx.app).get('/api/weeks')).body).toHaveLength(0);
    expect((await request(ctx.app).get(`/api/matches/${match.id}`)).status).toBe(404);
    expect((await request(ctx.app).get('/api/leaderboard?scope=season')).body).toHaveLength(0);

    const missing = await request(ctx.app).delete(`/api/weeks/${week.id}`);
    expect(missing.status).toBe(404);
  });

  it('rejects double-generation', async () => {
    const ctx = makeApp();
    const { week } = await seedLeague(ctx);
    const res = await request(ctx.app).post(`/api/weeks/${week.id}/generate-schedule`).send();
    expect(res.status).toBe(409);
  });
});
