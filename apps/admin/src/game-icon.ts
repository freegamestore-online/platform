/**
 * Storefront icon for a game published without one (#537). The create form
 * pre-fills the gamepad and most creators leave it, so half the store grid was
 * the same tile. The icon comes from the game's own words: the name is matched
 * first, then the description, then the category decides.
 */

/** The create form's pre-filled icon: left in place, it means "not chosen". */
export const DEFAULT_GAME_ICON = '🎮';

const KEYWORDS: [RegExp, string][] = [
  [/\b(cards?|blackjack|poker|solitaire|rummy)\b/, '🃏'],
  [/\b(dice|ludo|yahtzee)\b/, '🎲'],
  [/\b(chess|checkers)\b/, '♟️'],
  [/\b(snakes?|slither)\b/, '🐍'],
  [/\b(birds?|birdy|flappy)\b/, '🐦'],
  [/\b(fish\w*|ocean|sea)\b/, '🐟'],
  [/\b(frogs?)\b/, '🐸'],
  [/\b(zombies?|monsters?)\b/, '🧟'],
  [/\b(rac(e|es|ing)|cars?|karts?|drift)\b/, '🏎️'],
  [/\b(space|invaders?|aliens?|rockets?|asteroids?)\b/, '👾'],
  [/\b(golf)\b/, '⛳'],
  [/\b(balls?|soccer|football|basketball|tennis|pong)\b/, '⚽'],
  [/\b(jump\w*|platformer|climb\w*|obby|parkour)\b/, '🧗'],
  [/\b(words?|letters?|spell\w*|crossword|anagram)\b/, '🔤'],
  [/\b(math\w*|numbers?|sudoku)\b/, '🔢'],
  [/\b(puzzles?|jigsaw|match\w*|sort\w*)\b/, '🧩'],
  [/\b(tanks?|shoot\w*|battle|war|guns?)\b/, '💥'],
  [/\b(maze|labyrinth)\b/, '🌀'],
  [/\b(candy|fruits?|slic\w*|pizza|cook\w*)\b/, '🍬'],
  [/\b(tower|defen[cs]e|troops?|castle)\b/, '🏰'],
  [/\b(music\w*|piano|rhythm|keys)\b/, '🎹'],
  [/\b(quiz\w*|trivia)\b/, '❓'],
  [/\b(blocks?|stack\w*|bricks?|tetris)\b/, '🧱'],
  [/\b(farm\w*|garden\w*)\b/, '🌾'],
  [/\b(dragons?|magic\w*|wizards?|rpg|quest)\b/, '🧙'],
  [/\b(pinball|arcade)\b/, '🕹️'],
];

const BY_CATEGORY: Record<string, string> = {
  cards: '🃏',
  card: '🃏',
  casual: '🎈',
  'brain-training': '🧠',
  arcade: '🕹️',
  strategy: '♟️',
  puzzle: '🧩',
  sports: '⚽',
  action: '💥',
  board: '🎲',
  adventure: '🗺️',
};

export function pickGameIcon(name: string, description: string, category: string): string {
  for (const text of [name, description]) {
    const words = text.toLowerCase().replace(/[-_]+/g, ' ');
    const hit = KEYWORDS.find(([pattern]) => pattern.test(words));
    if (hit) return hit[1];
  }
  return BY_CATEGORY[category] ?? DEFAULT_GAME_ICON;
}
