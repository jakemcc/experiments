# StreakTracker Stats, Rename Guard, and Refresh Design

## Goal
Update count streak stats to start from a chosen date (inclusive), prevent renaming to an existing streak name, and refresh date-dependent UI on focus/visibility changes.

## Behavior Changes
- Count streak settings UI label changes to "Start from date" (keeps the existing custom date input).
- Stats for count streaks include all days from the chosen start date through today (inclusive), inserting zeros for missing days; data before the start date is excluded.
- Renaming a streak to a name that already exists is blocked with an alert; no merge occurs and no data changes are made.
- When the page regains focus or becomes visible, the app re-renders using the current date so month boundaries and stats stay accurate.

## Architecture and Data Flow
- Keep existing settings keys and parsing; interpret `countZeroStartDate` as the inclusive start for stat ranges.
- Introduce a helper to build the full day-by-day range of count values from the start date to today.
- Month stats use the same range and filter to the month being rendered; overall stats use the full range.
- Add a lightweight refresh function in `setup` that updates `now` and calls `rerenderAll`; attach it to `window.focus` and `document.visibilitychange`.

## Error Handling
- Rename collisions use `alert('A streak with that name already exists.')` and return early.
- Refresh is best-effort; no user-facing errors.

## Testing Strategy
- TDD for all behavior changes.
- New tests for:
  - Count stats excluding pre-start values and including zeros from the chosen start date.
  - Rename collision preventing merges and leaving selection/data unchanged.
  - Focus/visibility refresh updating date-dependent rendering.
- Update existing tests to match the "Start from date" label.

## Non-goals
- No new settings keys or migrations.
- No redesign of streak creation or storage.
