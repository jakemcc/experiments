# experiments

Experiments is a repository full of subdirectories.
Each subdirectory has its own little experiment and some sort of probably tiny web UI.

## Applications

- **Commitment** – A TypeScript browser app that asks "Today?" with two yes/no toggles for commit and held it. The commit choice locks after 30 seconds until the next day. The build script runs type checking as a linter and executes tests.
- **Streak Tracker** – A PWA for recording daily streaks with offline support and installability.
- **Counter** – A lightweight browser counter with increment and reset actions that logs completed counts in a history.

## Development

- `make dev` runs all tests/builds, watches all projects for changes, and serves `site/` at `http://localhost:8000`.
- Requires `watchexec` (e.g., `brew install watchexec`).
