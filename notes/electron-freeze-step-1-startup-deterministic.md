# Step 1 Lab: Make Startup Deterministic

## Goal

Before investigating the freeze, remove unrelated startup failures so students do not confuse one bug with another.

## What This Step Teaches

- Real debugging often starts by reducing noise.
- You cannot trust later observations if startup is failing for multiple reasons.
- "Fix the environment first" is often the right move.

## What Was Going Wrong

There were multiple startup problems mixed together:

- stale processes could keep port `5173` busy
- Electron window presentation was inconsistent
- desktop UI-state writes could race during startup

These failures made the app look unstable before we had even reached the real freeze.

## Prerequisites

- macOS
- the Nearbytes repo checked out locally
- `yarn` installed
- a terminal in the repo root

## Classroom Setup

Use the repo root:

```bash
cd /Users/akurz/alexhkurz-at-git/nearbytes-app
```

## Reproduction

Run:

```bash
yarn dev-run --kill
```

Things to look for:

- Vite port conflicts on `5173`
- Electron launching but not clearly presenting its window
- startup stack traces that are unrelated to the eventual freeze

## Why This Step Matters

If startup is flaky, students will misattribute later symptoms. The debugging process becomes much clearer once the app:

- starts reliably
- binds the expected port
- opens the same way each time

## Concrete Checks

### 1. Clear stale dev processes

Use the repo's built-in cleanup launcher:

```bash
yarn dev-run --kill
```

If you suspect a stale process is still holding `5173`, check:

```bash
lsof -nP -iTCP:5173 -sTCP:LISTEN
```

## 2. Verify the dev server is actually up

Look for output like:

```text
VITE v6.x.x ready
Local: http://127.0.0.1:5173/
```

## 3. Verify Electron is still running

Check for a live Electron process:

```bash
pgrep -af "Electron dist-electron/electron/main.js"
```

## 4. Verify the window lifecycle is deterministic

In the version used for the case study, this was improved by:

- creating the window hidden
- showing/focusing it explicitly once ready
- handling macOS `activate`

This eliminated "is it even open?" confusion.

## Expected Output

At the end of this step, students should have:

- a Vite dev server running
- an Electron process running
- no obvious startup crash

This does **not** solve the freeze. It just gives a stable baseline.

## Discussion Prompt

Ask students:

> Why is it dangerous to debug the "interesting" bug before stabilizing startup?

## Suggested Debrief

The lesson is that debugging is often sequential:

1. remove environmental noise
2. stabilize the run
3. only then begin hypothesis-driven investigation

## Takeaways

### Low-level / systems takeaway

Startup bugs are often about process state and operating-system resources, not just application logic. Ports, stale processes, temp files, and app lifecycle behavior can create misleading failures before the "real" bug even begins.

### Debugging takeaway

Do not start with the most interesting hypothesis. Start by making the system reproducible enough that later observations can be trusted.

### AI-tooling takeaway

AI is most helpful when the task is made concrete: check the port, inspect the process, read the startup script, remove stale state, rerun, compare. Structured iteration beats vague "fix the bug" prompting.

### Software development takeaway

Good software is easier to debug when startup is deterministic. Clear lifecycle code, reliable cleanup paths, and explicit app initialization are not just niceties; they reduce future debugging cost.
