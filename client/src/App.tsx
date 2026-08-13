import { NavLink, Route, Routes } from 'react-router-dom';
import RoundControl from './screens/RoundControl';
import Scoring from './screens/Scoring';
import Leaderboard from './screens/Leaderboard';
import Draft from './screens/Draft';
import Admin from './screens/Admin';

export default function App() {
  return (
    <>
      <header className="topbar">
        <div className="wordmark">
          SIDEOUT <small>LEAGUE SCOREBOARD</small>
        </div>
        <nav>
          <NavLink to="/" end>Rounds</NavLink>
          <NavLink to="/leaderboard">Leaderboard</NavLink>
          <NavLink to="/draft">Draft</NavLink>
          <NavLink to="/admin">Admin</NavLink>
        </nav>
      </header>
      <Routes>
        <Route path="/" element={<RoundControl />} />
        <Route path="/score/:matchId" element={<Scoring />} />
        <Route path="/leaderboard" element={<Leaderboard />} />
        <Route path="/draft" element={<Draft />} />
        <Route path="/admin" element={<Admin />} />
      </Routes>
    </>
  );
}
