import './index.css';
import { GameShell, GameTopbar } from '@freegamestore/games';
import { Footer } from './Footer.js';

const highScore = localStorage.getItem('high-score');

export default function App() {
  return (
    <GameShell topbar={<GameTopbar title="Passing App" />}>
      <main>
        <h1>Passing App</h1>
        <Footer />
      </main>
    </GameShell>
  );
}
