// Seeds the database with sample players (defaults for actions and settings
// are created automatically by openDb). Run: npm run seed -w server
import { openDb } from './db.js';

const SAMPLE_PLAYERS = [
  'Avery Brooks', 'Bailey Chen', 'Cameron Diaz', 'Dakota Evans', 'Emerson Fox',
  'Finley Gray', 'Gray Harper', 'Hayden Iverson', 'Indigo James', 'Jordan Kim',
  'Kai Lopez', 'Logan Moore', 'Morgan Nash', 'Noel Ortiz', 'Oakley Price',
  'Parker Quinn', 'Quinn Rivera', 'Riley Stone', 'Sage Taylor', 'Tatum Underwood',
  'Uma Vance', 'Vale Winters', 'Wren Xu', 'Xen Young', 'Yael Zimmer',
  'Zion Adams', 'Ash Bennett', 'Blair Cole', 'Cassidy Dunn', 'Drew Ellis',
  'Eden Frost', 'Flynn Grant', 'Gale Hunt', 'Harlow Ives', 'Ira Jones',
  'Jules Knight', 'Kit Lane', 'Lux Mason', 'Marlow North', 'Nico Olsen',
  'Onyx Park', 'Phoenix Reed', 'Reese Shaw', 'Skyler Tate', 'True Vaughn',
];

const db = openDb();
const existing = db.prepare('SELECT COUNT(*) AS n FROM players').get() as { n: number };
if (existing.n > 0) {
  console.log(`players table already has ${existing.n} rows — skipping player seed`);
} else {
  const insert = db.prepare('INSERT INTO players (name) VALUES (?)');
  const seedAll = db.transaction(() => {
    for (const name of SAMPLE_PLAYERS) insert.run(name);
  });
  seedAll();
  console.log(`seeded ${SAMPLE_PLAYERS.length} players`);
}
console.log('actions:', db.prepare('SELECT code, points FROM actions ORDER BY sort_order').all());
