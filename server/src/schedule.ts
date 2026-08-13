// The 5-team weekly round-robin is always the same shape. Labels map to
// that week's week_teams. Each round: two matches (court 1 and 2) and one bye
// team, which is never stored — it's derivable as the team in neither match.

export interface ScheduledRound {
  round_number: number;
  court1: [string, string]; // [home, away] labels
  court2: [string, string];
  bye: string;
}

export const ROUND_PATTERN: ScheduledRound[] = [
  { round_number: 1, court1: ['B', 'E'], court2: ['C', 'D'], bye: 'A' },
  { round_number: 2, court1: ['A', 'E'], court2: ['B', 'C'], bye: 'D' },
  { round_number: 3, court1: ['A', 'D'], court2: ['C', 'E'], bye: 'B' },
  { round_number: 4, court1: ['A', 'C'], court2: ['B', 'D'], bye: 'E' },
  { round_number: 5, court1: ['A', 'B'], court2: ['D', 'E'], bye: 'C' },
];

export interface MatchSpec {
  round_number: number;
  court: number;
  home_label: string;
  away_label: string;
}

/** Expand the fixed pattern into the 10 matches of a week. */
export function generateMatchSpecs(): MatchSpec[] {
  return ROUND_PATTERN.flatMap((r) => [
    { round_number: r.round_number, court: 1, home_label: r.court1[0], away_label: r.court1[1] },
    { round_number: r.round_number, court: 2, home_label: r.court2[0], away_label: r.court2[1] },
  ]);
}

export const TEAM_LABELS = ['A', 'B', 'C', 'D', 'E'] as const;
