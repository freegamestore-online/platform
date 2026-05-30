import { GameShell, GameTopbar } from '@freegamestore/games';
import './index.css';
import { Footer } from './Footer.js';

const _highScore = localStorage.getItem('high-score');

export default function App() {
  return (
    <GameShell topbar={<GameTopbar title="Passing Game" />}>
      <h1>Passing Game</h1>
      <Footer />
    </GameShell>
  );
}
