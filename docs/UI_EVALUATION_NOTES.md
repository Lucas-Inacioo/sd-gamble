# IHC evaluation preparation notes

This version separates presentation from interaction logic to make design iteration measurable. For an IHC assignment, treat this codebase as an MVP version and preserve a tagged copy before changing it after evaluations.

## Features suitable for evaluation

- Visibility of game states: waiting, active, spinning, finished and lost.
- Feedback after actions: queued bet, safe tile, cash out, loss and connection errors.
- Error prevention: buttons are disabled when an action is unavailable.
- Recognition rather than recall: visible labels show current status and available actions.
- Accessibility: keyboard focus is visible, controls have labels, and colors are paired with text or symbols.

## Recommended evaluation tasks

1. Start the Crash game and queue a demo bet with automatic cash out.
2. Explain when the Crash cash-out button becomes available.
3. Start Mines with three mines and reveal two cells.
4. Find a previous Double result in the API history panel.
5. Identify whether the interface is connected to the backend.

## Candidate improvements after evidence is collected

Do not claim these were implemented until an evaluation supports them. They are useful hypotheses:

- make technical debug panels collapsible for non-technical users;
- add a compact help explanation near Auto cash out;
- add an explicit reconnecting state;
- simplify persisted history for mobile screens;
- add a reduce-motion setting in addition to the current browser preference support.
