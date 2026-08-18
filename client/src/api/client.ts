import type {
  Action,
  AwardsResponse,
  DraftPayload,
  LeaderboardRow,
  MatchDetailResponse,
  Player,
  ScoringEvent,
  Week,
  WeekMatchesResponse,
} from '@shared/types';

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  players: () => http<Player[]>('/api/players'),
  createPlayer: (body: { name: string; squad?: string | null; position?: string | null }) =>
    http<Player>('/api/players', { method: 'POST', body: JSON.stringify(body) }),
  patchPlayer: (id: number, body: Partial<Pick<Player, 'name' | 'squad' | 'position' | 'active'>>) =>
    http<Player>(`/api/players/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  importPlayers: (csv: string) =>
    http<{ imported: number; names: string[]; skipped: string[]; errors: string[] }>(
      '/api/players/import',
      { method: 'POST', body: JSON.stringify({ csv }) }
    ),

  weeks: () => http<Week[]>('/api/weeks'),
  currentWeek: () => http<Week>('/api/weeks/current'),
  createWeek: (body: { week_number: number; date: string }) =>
    http<{ week: Week }>('/api/weeks', { method: 'POST', body: JSON.stringify(body) }),
  deleteWeek: (id: number, dryRun = false) =>
    http<{ deleted: boolean; matches: number; events: number }>(
      `/api/weeks/${id}${dryRun ? '?dry_run=1' : ''}`,
      { method: 'DELETE' }
    ),
  submitDraft: (weekId: number, body: DraftPayload) =>
    http(`/api/weeks/${weekId}/draft`, { method: 'POST', body: JSON.stringify(body) }),
  generateSchedule: (weekId: number) =>
    http<WeekMatchesResponse>(`/api/weeks/${weekId}/generate-schedule`, { method: 'POST' }),
  weekMatches: (weekId: number) => http<WeekMatchesResponse>(`/api/weeks/${weekId}/matches`),

  match: (id: number) => http<MatchDetailResponse>(`/api/matches/${id}`),
  patchMatch: (id: number, body: { status?: string; winner_team_id?: number | null }) =>
    http(`/api/matches/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteEvent: (id: number) => http(`/api/events/${id}`, { method: 'DELETE' }),
  deleteScoreTap: (id: number) => http(`/api/score-taps/${id}`, { method: 'DELETE' }),
  matchEvents: (matchId: number) => http<ScoringEvent[]>(`/api/matches/${matchId}/events`),

  actions: (all = false) => http<Action[]>(`/api/actions${all ? '?all=1' : ''}`),
  createAction: (body: { code?: string; label: string; points: number; team_points?: number; sort_order?: number }) =>
    http<Action>('/api/actions', { method: 'POST', body: JSON.stringify(body) }),
  updateAction: (id: number, body: Partial<Pick<Action, 'label' | 'points' | 'team_points' | 'sort_order' | 'active'>>) =>
    http<Action>(`/api/actions/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteAction: (id: number) => http(`/api/actions/${id}`, { method: 'DELETE' }),

  settings: () => http<Record<string, string>>('/api/settings'),
  saveSettings: (body: Record<string, string>) =>
    http<Record<string, string>>('/api/settings', { method: 'PUT', body: JSON.stringify(body) }),

  leaderboard: (scope: 'season' | 'week', weekId?: number) =>
    http<LeaderboardRow[]>(
      scope === 'week' ? `/api/leaderboard?scope=week&week_id=${weekId}` : '/api/leaderboard?scope=season'
    ),
  awards: () => http<AwardsResponse>('/api/awards'),
};
