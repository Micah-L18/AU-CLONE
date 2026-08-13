import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { makeApp, seedLeague } from './helpers.js';

describe('leaderboard aggregation', () => {
  it('season totals match hand-computed sums across matches', async () => {
    const ctx = makeApp();
    const { schedule, playerIds } = await seedLeague(ctx);
    const actions = (await request(ctx.app).get('/api/actions')).body as {
      id: number; code: string; points: number;
    }[];
    const byCode = new Map(actions.map((a) => [a.code, a]));
    const kill = byCode.get('kill')!; // 8
    const ace = byCode.get('ace')!; // 12
    const dig = byCode.get('dig')!; // 5

    const m1 = schedule.rounds[0].matches[0].id;
    const m2 = schedule.rounds[0].matches[1].id;
    const p1 = playerIds[9]; // on team B (playing round 1 court 1)
    const p2 = playerIds[18]; // on team C (playing round 1 court 2)

    // p1: 2 kills + 1 ace = 28; p2: 3 digs = 15
    const taps = [
      { match: m1, player: p1, action: kill.id },
      { match: m1, player: p1, action: kill.id },
      { match: m1, player: p1, action: ace.id },
      { match: m2, player: p2, action: dig.id },
      { match: m2, player: p2, action: dig.id },
      { match: m2, player: p2, action: dig.id },
    ];
    for (const [i, t] of taps.entries()) {
      await request(ctx.app)
        .post(`/api/matches/${t.match}/events`)
        .send({ player_id: t.player, action_id: t.action, client_id: `lb-${i}` });
    }

    const season = (await request(ctx.app).get('/api/leaderboard?scope=season')).body;
    expect(season[0]).toMatchObject({ player_id: p1, total: 28 });
    expect(season[1]).toMatchObject({ player_id: p2, total: 15 });
    expect(season).toHaveLength(2);
  });

  it('week scope filters to that week and awards reflect the data', async () => {
    const ctx = makeApp();
    const { week, schedule, playerIds } = await seedLeague(ctx);
    const actions = (await request(ctx.app).get('/api/actions')).body as {
      id: number; code: string;
    }[];
    const ace = actions.find((a) => a.code === 'ace')!;
    const m1 = schedule.rounds[0].matches[0].id;
    const p1 = playerIds[9];

    await request(ctx.app)
      .post(`/api/matches/${m1}/events`)
      .send({ player_id: p1, action_id: ace.id, client_id: 'wk-1' });

    const weekBoard = (
      await request(ctx.app).get(`/api/leaderboard?scope=week&week_id=${week.id}`)
    ).body;
    expect(weekBoard).toHaveLength(1);
    expect(weekBoard[0].total).toBe(12);

    const awards = (await request(ctx.app).get('/api/awards')).body;
    expect(awards.champion.player_id).toBe(p1);
    expect(awards.single_week_high).toMatchObject({
      player_id: p1,
      week_number: 1,
      total: 12,
    });
    expect(awards.best_average.player_id).toBe(p1);
  });

  it('custom actions score with their configured points', async () => {
    const ctx = makeApp();
    const { schedule, playerIds } = await seedLeague(ctx);
    const created = await request(ctx.app)
      .post('/api/actions')
      .send({ code: 'serve_streak', label: 'Serve Streak', points: 15 });
    expect(created.status).toBe(201);

    const m1 = schedule.rounds[0].matches[0].id;
    await request(ctx.app)
      .post(`/api/matches/${m1}/events`)
      .send({ player_id: playerIds[9], action_id: created.body.id, client_id: 'cust-1' });

    const season = (await request(ctx.app).get('/api/leaderboard?scope=season')).body;
    expect(season[0].total).toBe(15);
  });
});
