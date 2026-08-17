// Shared entity and API payload types used by both server and client.

export type Squad = 'varsity' | 'jv' | 'freshman' | null;

export const POSITIONS = ['Setter', 'Outside', 'Opposite', 'Middle', 'Lib', 'DS'] as const;
export type Position = (typeof POSITIONS)[number];

export interface Player {
  id: number;
  name: string;
  squad: Squad;
  position: Position | null;
  active: number; // 1 | 0
  created_at: string;
}

export type WeekStatus = 'draft' | 'scheduled' | 'in_progress' | 'complete';

export interface Week {
  id: number;
  week_number: number;
  date: string;
  status: WeekStatus;
}

export interface WeekTeam {
  id: number;
  week_id: number;
  label: string; // 'A'..'E'
  captain_id: number | null;
}

export interface RosterEntry {
  id: number;
  week_team_id: number;
  player_id: number;
}

export type MatchStatus = 'pending' | 'live' | 'final';

export interface Match {
  id: number;
  week_id: number;
  round_number: number; // 1..5
  court: number; // 1 | 2
  home_team_id: number;
  away_team_id: number;
  status: MatchStatus;
  winner_team_id: number | null;
  started_at: string | null;
  ended_at: string | null;
}

export interface Action {
  id: number;
  code: string;
  label: string;
  points: number;
  sort_order: number;
  active: number; // 1 | 0
  system: number; // 1 = built-in (e.g. 'win'), cannot be deleted
}

export interface ScoringEvent {
  id: number;
  match_id: number;
  player_id: number;
  action_id: number;
  points: number; // snapshot of action.points at tap time
  created_at: string;
  device: string | null;
  client_id: string | null;
}

// ---- Composite API responses ----

export interface TeamWithRoster extends WeekTeam {
  players: Player[];
}

export interface RoundMatches {
  round_number: number;
  matches: Match[];
  bye_team_id: number | null;
}

export interface WeekMatchesResponse {
  week: Week;
  teams: TeamWithRoster[];
  rounds: RoundMatches[];
}

export interface PlayerMatchTotal {
  player_id: number;
  total: number;
  event_count: number;
}

export interface MatchDetailResponse {
  match: Match;
  home: TeamWithRoster;
  away: TeamWithRoster;
  totals: PlayerMatchTotal[];
  home_score: number;
  away_score: number;
}

export interface LeaderboardRow {
  player_id: number;
  name: string;
  total: number;
  weeks_played: number;
  avg_per_week: number;
}

export interface AwardsResponse {
  champion: LeaderboardRow | null;
  single_week_high: { player_id: number; name: string; week_id: number; week_number: number; total: number } | null;
  best_average: LeaderboardRow | null;
}

// ---- Request payloads ----

export interface CreateEventPayload {
  player_id: number;
  action_id: number;
  client_id: string;
  device?: string;
}

export interface DraftPayload {
  teams: {
    week_team_id: number;
    captain_id: number | null;
    player_ids: number[];
  }[];
}
