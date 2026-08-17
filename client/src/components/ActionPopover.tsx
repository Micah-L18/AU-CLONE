import type { Action, Player } from '@shared/types';

interface Props {
  player: Player;
  actions: Action[];
  onPick: (action: Action) => void;
  onClose: () => void;
}

const fmt = (n: number) => (n > 0 ? `+${n}` : `${n}`);

/** Player-first flow: the player was tapped, now say what they did. */
export default function ActionPopover({ player, actions, onPick, onClose }: Props) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="popover" onClick={(e) => e.stopPropagation()}>
        <h3>{player.name}</h3>
        <div className="action-grid">
          {actions
            .filter((a) => a.system !== 1)
            .map((a) => (
              <button key={a.id} className={`action-btn ${a.points < 0 ? 'negative' : ''}`} onClick={() => onPick(a)}>
                <span className="alabel">{a.label}</span>
                <span className="apts">
                  {fmt(a.points)} them · {fmt(a.team_points)} each teammate
                </span>
              </button>
            ))}
        </div>
        <div style={{ marginTop: 18, textAlign: 'right' }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
