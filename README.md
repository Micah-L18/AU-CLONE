# Sideout — Volleyball League Scoreboard

A scoring app for a 5-team volleyball league where **teams reshuffle every week but points belong to players**. The bye team scores both live matches on iPads; every point is an individual event that follows the player across the whole season.

**Stack:** React + TypeScript (Vite) · Node + Express + TypeScript · SQLite (better-sqlite3)

## Quick start

```bash
npm install
npm run seed        # default actions/settings + 45 sample players
npm run dev         # API on :3001, app on :5173
```

Open http://localhost:5173 and:

1. **Admin** → Create week 1
2. **Draft** → pick 5 captains (season top-5 pre-suggested), snake-draft the pool, submit
3. **Admin** → Generate schedule (fixed 5-round / 2-court round-robin, one bye team per round)
4. **Rounds** → the bye team's iPads each pick a court and score
5. **Leaderboard** → season standings, weekly views, and awards — live via polling

```bash
npm test            # server test suite (schedule, events, win bonus, leaderboard)
```

## How scoring works

- The `events` table is the **single source of truth**. One tap = one row: `(match, player, action, points)`.
- `events.points` is a **snapshot** of the action's value at tap time — retuning point values in Admin never rewrites past results.
- Leaderboards, weekly totals, and awards are all `SUM` queries over events. Nothing to keep in sync.
- **Everything is tunable in Admin**: rename/re-point/disable any action, add new ones, and set the win bonus (finalizing a match awards the `win` action's current value to every player on the winning roster — re-finalizing with a different winner swaps the bonuses).
- The bye team is never stored — it's derived as the team not playing in a round.

## Built for a gym with bad wifi

- **Optimistic UI**: taps render instantly; the POST happens in the background.
- **Offline tap queue**: every tap gets a UUID and is written to localStorage *before* the network is involved, then synced in order when the connection returns. The server treats the UUID as an idempotency key, so retries can never double-count.
- **Undo is first-class**: a big persistent undo bar; unsynced taps are removed locally, synced ones are deleted by id.
- Live screens poll every few seconds and keep the last good data through dropouts.

## Layout

```
shared/types.ts        shared API + entity types
server/src/schema.sql  tables: players, weeks, week_teams, rosters, matches, actions, events, settings
server/src/schedule.ts fixed round-robin pattern (unit-tested)
server/src/routes/     players, weeks (draft + schedule), matches (finalize + win bonus),
                       events (idempotent hot path + undo), actions, settings, leaderboard
client/src/screens/    RoundControl, Scoring, Leaderboard, Draft, Admin
client/src/offline/    localStorage tap queue + sync loop
```
