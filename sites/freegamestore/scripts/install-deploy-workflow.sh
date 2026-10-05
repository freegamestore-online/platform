#!/usr/bin/env bash
set -eo pipefail

REPOS_DIR="${1:-/Users/serge/dev/fgs}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TEMPLATE="$SCRIPT_DIR/../deploy-workflow.yml"

declare -A PROJECT_MAP=(
  [chess]=freechessapp
  [puzzle]=freepuzzle
  [tetris]=freetetrisapp
  [snake]=freesnakeapp
  [minesweeper]=freeminesweeperapp
  [2048]=free2048app
  [slither]=freeslitherapp
  [racing]=freeracingapp
  [bowling]=freebowlingapp
  [spaceshooter]=freespaceshooterapp
  [breakout]=freebreakoutapp
  [platformer]=freeplatformerapp
  [sudoku]=freesudokuapp
  [pacman]=freepacmanapp
  [pong]=freepongapp
  [flappy]=freeflappyapp
  [solitaire]=freesolitaireapp
  [connect4]=freeconnect4app
  [wordle]=freewordleapp
  [simon]=freesimonapp
  [mahjong]=freemahjongapp
  [checkers]=freecheckersapp
  [hangman]=freehangmanapp
  [memory]=freememoryapp
  [frogger]=freefroggerapp
  [match3]=freematch3app
  [whackamole]=freewhackamoleapp
  [wordsearch]=freewordsearchapp
  [asteroids]=freeasteroidsapp
)

for repo in "${!PROJECT_MAP[@]}"; do
  repo_dir="$REPOS_DIR/$repo"
  cf_project="${PROJECT_MAP[$repo]}"

  if [ ! -d "$repo_dir/.git" ]; then
    echo "SKIP: $repo_dir is not a git repo"
    continue
  fi

  echo "Installing deploy workflow for $repo -> $cf_project"

  mkdir -p "$repo_dir/.github/workflows"
  sed "s/__CF_PROJECT_PLACEHOLDER__/$cf_project/" "$TEMPLATE" > "$repo_dir/.github/workflows/deploy.yml"

  git -C "$repo_dir" add .github/workflows/deploy.yml
  git -C "$repo_dir" commit -m "Add Cloudflare Pages deploy workflow"
  git -C "$repo_dir" push
done

echo "Done."
