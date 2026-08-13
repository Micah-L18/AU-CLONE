import { openDb } from './db.js';
import { createApp } from './app.js';

const PORT = Number(process.env.PORT ?? 3001);
const db = openDb();
const app = createApp(db);

app.listen(PORT, () => {
  console.log(`Scoring API listening on http://localhost:${PORT}`);
});
