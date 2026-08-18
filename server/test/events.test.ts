import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { makeApp, seedLeague, type TestContext } from './helpers.js';

interface Fixture {
  ctx: TestContext;
  matchId: number;
  homeTeamId: number;
  homePlayerIds: number[];
  killActionId: number;
}

async function fixture(): Promise<Fixture> {
  const ctx = makeApp();
  const { schedule } = await seedLeague(ctx);
  const match = schedule.rounds[0].matches[0];
  const detail = await request(ctx.app).get(`/api/matches/${match.id}`);
  const actions = await request(ctx.app).get('/api/actions');
  const kill = actions.body.find((a: { code: string }) => a.code === 'kill');
  return {
    ctx,
    matchId: match.id,
    homeTeamId: match.home_team_id,
    homePlayerIds: detail.body.home.players.map((p: { id: number }) => p.id),
    killActionId: kill.id,
  };
}

describe('event scoring', () => {
  let f: Fixture;
  beforeEach(async () => {
    f = await fixture();
  });

  it('creates an event snapshotting the action points', async () => {
    const res = await request(f.ctx.app)
      .post(`/api/matches/${f.matchId}/events`)
      .send({ player_id: f.homePlayerIds[0], action_id: f.killActionId, client_id: 'tap-1' });
    expect(res.status).toBe(201);
    expect(res.body.points).toBe(8);

    // Retune the action; the recorded event keeps its snapshot.
    await request(f.ctx.app).put(`/api/actions/${f.killActionId}`).send({ points: 99 });
    const events = await request(f.ctx.app).get(`/api/matches/${f.matchId}/events`);
    expect(events.body[0].points).toBe(8);
  });

  it('earner gets player points; every teammate gets the team points', async () => {
    // Default kill: 2 team points, 8 player points.
    const res = await request(f.ctx.app)
      .post(`/api/matches/${f.matchId}/events`)
      .send({ player_id: f.homePlayerIds[0], action_id: f.killActionId, client_id: 'split-1' });
    expect(res.body.team_points).toBe(2);
    expect(res.body.points).toBe(8);

    const detail = await request(f.ctx.app).get(`/api/matches/${f.matchId}`);
    expect(detail.body.home_score).toBe(0); // rally score is manual, not action-driven
    expect(detail.body.away_score).toBe(0);
    const totals = detail.body.totals as { player_id: number; total: number; event_count: number }[];
    const earner = totals.find((t) => t.player_id === f.homePlayerIds[0]);
    expect(earner).toEqual({ player_id: f.homePlayerIds[0], total: 8, event_count: 1 });
    // The other 8 rostered teammates each banked the 2 team points.
    const mates = totals.filter((t) => t.player_id !== f.homePlayerIds[0]);
    expect(mates).toHaveLength(8);
    expect(mates.every((t) => t.total === 2 && t.event_count === 0)).toBe(true);

    // Both tracks snapshot independently at tap time.
    await request(f.ctx.app).put(`/api/actions/${f.killActionId}`).send({ team_points: 99, points: 77 });
    const events = await request(f.ctx.app).get(`/api/matches/${f.matchId}/events`);
    expect(events.body[0].team_points).toBe(2);
    expect(events.body[0].points).toBe(8);
  });

  it('is idempotent on client_id (offline retry safe)', async () => {
    const payload = { player_id: f.homePlayerIds[0], action_id: f.killActionId, client_id: 'dup-1' };
    const first = await request(f.ctx.app).post(`/api/matches/${f.matchId}/events`).send(payload);
    const second = await request(f.ctx.app).post(`/api/matches/${f.matchId}/events`).send(payload);
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);
    const events = await request(f.ctx.app).get(`/api/matches/${f.matchId}/events`);
    expect(events.body).toHaveLength(1);
  });

  it('undo deletes a single tap', async () => {
    const res = await request(f.ctx.app)
      .post(`/api/matches/${f.matchId}/events`)
      .send({ player_id: f.homePlayerIds[0], action_id: f.killActionId, client_id: 'undo-1' });
    const del = await request(f.ctx.app).delete(`/api/events/${res.body.id}`);
    expect(del.status).toBe(200);
    const events = await request(f.ctx.app).get(`/api/matches/${f.matchId}/events`);
    expect(events.body).toHaveLength(0);
  });

  it('rejects inactive actions', async () => {
    await request(f.ctx.app).put(`/api/actions/${f.killActionId}`).send({ active: 0 });
    const res = await request(f.ctx.app)
      .post(`/api/matches/${f.matchId}/events`)
      .send({ player_id: f.homePlayerIds[0], action_id: f.killActionId, client_id: 'x-1' });
    expect(res.status).toBe(400);
  });
});

describe('rally score (+1 taps)', () => {
  let f: Fixture;
  beforeEach(async () => {
    f = await fixture();
  });

  it('increments per team, idempotent on client_id', async () => {
    const first = await request(f.ctx.app)
      .post(`/api/matches/${f.matchId}/score`)
      .send({ team_id: f.homeTeamId, client_id: 'pt-1' });
    expect(first.status).toBe(201);
    await request(f.ctx.app)
      .post(`/api/matches/${f.matchId}/score`)
      .send({ team_id: f.homeTeamId, client_id: 'pt-2' });
    // offline retry of pt-1 must not double-count
    const dup = await request(f.ctx.app)
      .post(`/api/matches/${f.matchId}/score`)
      .send({ team_id: f.homeTeamId, client_id: 'pt-1' });
    expect(dup.status).toBe(200);

    const detail = await request(f.ctx.app).get(`/api/matches/${f.matchId}`);
    expect(detail.body.home_score).toBe(2);
    expect(detail.body.away_score).toBe(0);
    // rally points never touch player totals
    expect(detail.body.totals).toEqual([]);
  });

  it('supports undo via delete and rejects foreign teams', async () => {
    const tap = await request(f.ctx.app)
      .post(`/api/matches/${f.matchId}/score`)
      .send({ team_id: f.homeTeamId, client_id: 'pt-undo' });
    await request(f.ctx.app).delete(`/api/score-taps/${tap.body.id}`);
    const detail = await request(f.ctx.app).get(`/api/matches/${f.matchId}`);
    expect(detail.body.home_score).toBe(0);

    const bad = await request(f.ctx.app)
      .post(`/api/matches/${f.matchId}/score`)
      .send({ team_id: 99999, client_id: 'pt-bad' });
    expect(bad.status).toBe(400);
  });
});

describe('match finalize with win bonus', () => {
  let f: Fixture;
  beforeEach(async () => {
    f = await fixture();
  });

  it('awards the tunable win bonus to each winning-roster player', async () => {
    await request(f.ctx.app)
      .patch(`/api/matches/${f.matchId}`)
      .send({ status: 'final', winner_team_id: f.homeTeamId });
    const events = await request(f.ctx.app).get(`/api/matches/${f.matchId}/events`);
    // 9 players on the winning roster, default win bonus 25.
    expect(events.body).toHaveLength(9);
    expect(events.body.every((e: { points: number }) => e.points === 25)).toBe(true);
  });

  it('re-finalizing with a different winner replaces the bonuses', async () => {
    const detail = await request(f.ctx.app).get(`/api/matches/${f.matchId}`);
    const awayTeamId = detail.body.match.away_team_id;
    const awayPlayerIds = new Set(detail.body.away.players.map((p: { id: number }) => p.id));

    await request(f.ctx.app)
      .patch(`/api/matches/${f.matchId}`)
      .send({ status: 'final', winner_team_id: f.homeTeamId });
    await request(f.ctx.app)
      .patch(`/api/matches/${f.matchId}`)
      .send({ winner_team_id: awayTeamId });

    const events = await request(f.ctx.app).get(`/api/matches/${f.matchId}/events`);
    expect(events.body).toHaveLength(9);
    expect(events.body.every((e: { player_id: number }) => awayPlayerIds.has(e.player_id))).toBe(true);
  });

  it('reopening a final match removes win bonuses but keeps tap events', async () => {
    await request(f.ctx.app)
      .post(`/api/matches/${f.matchId}/events`)
      .send({ player_id: f.homePlayerIds[0], action_id: f.killActionId, client_id: 'keep-1' });
    await request(f.ctx.app)
      .patch(`/api/matches/${f.matchId}`)
      .send({ status: 'final', winner_team_id: f.homeTeamId });
    await request(f.ctx.app).patch(`/api/matches/${f.matchId}`).send({ status: 'pending' });

    const events = await request(f.ctx.app).get(`/api/matches/${f.matchId}/events`);
    expect(events.body).toHaveLength(1);
    expect(events.body[0].client_id).toBe('keep-1');
  });

  it('rejects a winner that is not in the match', async () => {
    const res = await request(f.ctx.app)
      .patch(`/api/matches/${f.matchId}`)
      .send({ status: 'final', winner_team_id: 99999 });
    expect(res.status).toBe(400);
  });
});
