# experiments

Experiments is a repository full of subdirectories.
Each subdirectory has its own little experiment and some sort of probably tiny web UI.

## Applications

- **Streak Tracker** – A PWA for recording daily streaks with offline support and installability.
- **Counter** – A lightweight browser counter with increment and reset actions that logs completed counts in a history.

## Experiment graveyard

Commitment explored a tiny precommitment flow: pick an action for the day, then return later to record whether you kept the commitment. It was a way to separate intent from follow-through and capture that simple accountability loop.

## Development

- `make dev` runs all tests/builds, watches all projects for changes, and serves `site/` at `http://localhost:8000`.
- Requires `watchexec` (e.g., `brew install watchexec`).
