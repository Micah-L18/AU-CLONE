import express from 'express';
import cors from 'cors';
import type { DB } from './db.js';
import { playersRouter } from './routes/players.js';
import { weeksRouter } from './routes/weeks.js';
import { matchesRouter } from './routes/matches.js';
import { matchEventsRouter, eventsRouter } from './routes/events.js';
import { actionsRouter } from './routes/actions.js';
import { settingsRouter } from './routes/settings.js';
import { leaderboardRouter, awardsRouter } from './routes/leaderboard.js';

export function createApp(db: DB): express.Express {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.use('/api/players', playersRouter(db));
  app.use('/api/weeks', weeksRouter(db));
  app.use('/api/matches', matchesRouter(db));
  app.use('/api/matches/:matchId/events', matchEventsRouter(db));
  app.use('/api/events', eventsRouter(db));
  app.use('/api/actions', actionsRouter(db));
  app.use('/api/settings', settingsRouter(db));
  app.use('/api/leaderboard', leaderboardRouter(db));
  app.use('/api/awards', awardsRouter(db));

  return app;
}
