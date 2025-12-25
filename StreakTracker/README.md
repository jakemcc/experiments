# Streak Tracker

Streak Tracker is an offline-capable PWA for recording daily streaks. Each streak has a type that is selected at creation time:

## Streak types

- **Colors**: tap a day to cycle through empty → red → green → blue → empty.
- **Count**: use the **+** button at the top of a day to increment, and the **–** button at the bottom to decrement. Counts never go below zero.

Streak types cannot be changed after creation. Create a new streak if you want a different type.

## Running tests

```bash
npm test
```

## Manual verification

1. Create a new streak and choose **Colors**; tap a day to confirm it cycles through the four color states.
2. Create a new streak and choose **Count**; use **+** and **–** to verify the count increments and clamps at zero.
3. Reload the page to confirm both streak types persist with their stored values.
