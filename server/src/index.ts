import express from 'express';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { createApp } from './app.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3001);
const db = openDb();
const app = createApp(db);

// In production (Docker) the built client is served from the same process —
// one container, one port. In dev, Vite serves the client and proxies /api.
const clientDist = process.env.CLIENT_DIST ?? join(__dirname, '..', '..', 'client', 'dist');
if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(join(clientDist, 'index.html'));
  });
  console.log(`serving client from ${clientDist}`);
}

app.listen(PORT, () => {
  console.log(`Scoring API listening on http://localhost:${PORT}`);
});
