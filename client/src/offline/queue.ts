// Offline-first tap queue. Every tap gets a UUID client_id and is written to
// localStorage BEFORE the network is involved, so a wifi dropout never loses
// a point. A background loop flushes the queue in order; the server's
// client_id idempotency makes retries safe to repeat.

import type { ScoringEvent } from '@shared/types';

export interface QueuedTap {
  client_id: string;
  match_id: number;
  kind?: 'action' | 'score'; // absent = 'action' (pre-score-tap queues)
  // action taps
  player_id?: number;
  action_id?: number;
  // score taps (+1 on the scoreboard)
  team_id?: number;
  delta?: number;
  device?: string;
}

const KEY = 'sideout.tap-queue.v1';
type SyncListener = () => void;

function load(): QueuedTap[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as QueuedTap[];
  } catch {
    return [];
  }
}

function save(queue: QueuedTap[]): void {
  localStorage.setItem(KEY, JSON.stringify(queue));
}

// client_id -> server event id, learned as taps sync (in-memory; the undo
// stack only lives as long as the scoring session anyway).
const serverIds = new Map<string, number>();
const listeners = new Set<SyncListener>();
let flushing = false;
let timer: ReturnType<typeof setInterval> | null = null;

function notify(): void {
  for (const fn of listeners) fn();
}

export function onQueueChange(fn: SyncListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function pendingCount(): number {
  return load().length;
}

export function pendingForMatch(matchId: number): QueuedTap[] {
  return load().filter((t) => t.match_id === matchId);
}

export function serverIdFor(clientId: string): number | undefined {
  return serverIds.get(clientId);
}

export function enqueueTap(tap: QueuedTap): void {
  const queue = load();
  queue.push(tap);
  save(queue);
  notify();
  void flush();
}

/** Remove an unsynced tap locally (undo before it ever reached the server). */
export function removeQueued(clientId: string): boolean {
  const queue = load();
  const idx = queue.findIndex((t) => t.client_id === clientId);
  if (idx === -1) return false;
  queue.splice(idx, 1);
  save(queue);
  notify();
  return true;
}

export async function flush(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    while (true) {
      const queue = load();
      const tap = queue[0];
      if (!tap) break;
      const res =
        tap.kind === 'score'
          ? await fetch(`/api/matches/${tap.match_id}/score`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                team_id: tap.team_id,
                delta: tap.delta ?? 1,
                client_id: tap.client_id,
              }),
            })
          : await fetch(`/api/matches/${tap.match_id}/events`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                player_id: tap.player_id,
                action_id: tap.action_id,
                client_id: tap.client_id,
                device: tap.device,
              }),
            });
      if (res.status === 400 || res.status === 404) {
        // Permanently rejected (deleted player/action/match) — drop it so the
        // queue can't wedge.
        console.warn('tap rejected by server, dropping', tap, await res.text());
      } else if (!res.ok) {
        break; // transient — leave at head of queue and retry later
      } else {
        const created = (await res.json()) as ScoringEvent | { id: number };
        serverIds.set(tap.client_id, created.id);
      }
      removeQueued(tap.client_id);
    }
  } catch {
    // network down — the interval/online listener will retry
  } finally {
    flushing = false;
    notify();
  }
}

export function startSyncLoop(): void {
  if (timer) return;
  timer = setInterval(() => void flush(), 3000);
  window.addEventListener('online', () => void flush());
  void flush();
}
