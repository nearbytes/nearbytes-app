# Lesson Plan: Hunting an Electron Freeze

## Purpose

This lesson plan is designed for an instructor who wants to run the Electron freeze case study in class without having to reconstruct the debugging session from memory.

This plan assumes:

- no pre-class reading
- students can follow a live debugging session
- the instructor wants a step-by-step structure with clear stopping points

## Learning Goals

By the end of the lesson, students should be able to:

1. explain why a UI symptom does not necessarily imply a UI-layer bug
2. describe how to narrow a debugging search space systematically
3. use runtime evidence to decide what subsystem to inspect next
4. understand how Electron's multi-process model changes debugging strategy
5. explain why the final fix was the right fix

## Time Budget

Recommended total time: `50-75 minutes`

Suggested pacing:

- Introduction and setup: `5 minutes`
- Step 1: `5 minutes`
- Step 2: `7 minutes`
- Step 3: `10 minutes`
- Step 4: `5 minutes`
- Step 5: `10 minutes`
- Step 6: `5 minutes`
- Step 7: `10 minutes`
- Wrap-up and further reading: `5-15 minutes`

If you are short on time, the essential arc is:

- Step 2
- Step 4
- Step 5
- Step 6
- Step 7

## Repo Starting Point

Use this exact commit:

- [`07aa249b306c436a3973add886f9a914782770bc`](https://github.com/nearbytes/nearbytes-app/commit/07aa249b306c436a3973add886f9a914782770bc)

## Files You May Want Open

- `notes/electron-freeze-case-study.md`
- `notes/electron-freeze-step-1-startup-deterministic.md`
- `notes/electron-freeze-step-2-window-lifecycle.md`
- `notes/electron-freeze-step-3-renderer-console-and-diagnostics.md`
- `notes/electron-freeze-step-4-process-metrics.md`
- `notes/electron-freeze-step-5-native-sampling.md`
- `notes/electron-freeze-step-6-codebase-search-watchers.md`
- `notes/electron-freeze-step-7-watch-lifecycle-and-fix.md`

## Instructor Preparation

Before class, make sure:

- the repo is on the correct commit
- `yarn` dependencies are installed
- you can run `yarn dev-run --kill`
- the machine has realistic cloud folders if you want the full watcher story to be vivid
- macOS `sample` is available

## Lesson Structure

## 1. Opening Framing

### What to say

Say something like:

> "Today we will debug a bug that looks like a UI freeze, but the real cause is deeper in the system. The point is not just to fix the bug. The point is to learn how to move from symptoms to evidence to a justified explanation."

### What to emphasize

- students should resist early certainty
- every step should answer a narrower question
- we will not guess the answer first and then force the evidence to fit

## 2. Introduce the Symptom

### Show

Describe the original symptom:

- Electron app opens or appears in the dock
- browser app works on `http://127.0.0.1:5173/`
- Electron becomes beachbally or stuck when interacting with it

### Ask students

> "What would you suspect first?"

Expected answers:

- renderer crash
- bad event handler
- GPU bug
- window not showing correctly

### Teaching point

Most of these are reasonable first guesses. The whole lesson is about how to avoid stopping there.

## 3. Step 1: Make Startup Deterministic

Reference:

- `notes/electron-freeze-step-1-startup-deterministic.md`

### Run

```bash
yarn dev-run --kill
```

### What to do live

- point out port conflicts or stale-process issues if they appear
- explain why startup noise must be removed first

### Ask students

> "Why is it risky to debug the interesting failure before cleaning up startup?"

### Main teaching point

Reproducibility comes before explanation.

## 4. Step 2: Instrument Window Lifecycle

Reference:

- `notes/electron-freeze-step-2-window-lifecycle.md`

### Show

Explain the lifecycle logs:

- `dom-ready`
- `ready-to-show`
- `did-finish-load`
- `did-fail-load`
- `render-process-gone`
- `unresponsive`

### What to say

> "We want to know whether the app dies before first paint or whether it loads and gets stuck later."

### Ask students

> "If `did-finish-load` fires, what explanations become less likely?"

### Main teaching point

Lifecycle instrumentation eliminates whole families of bugs quickly.

## 5. Step 3: Redirect Renderer Console and Add Diagnostics

Reference:

- `notes/electron-freeze-step-3-renderer-console-and-diagnostics.md`

### Show

Explain that DevTools are often inconvenient or unavailable when the desktop app is sick, so we forward renderer logs to the terminal.

### Explain the diagnostic categories

- uncaught errors
- unhandled promise rejections
- slow pointer handlers
- long tasks
- frame gaps
- event-loop stalls

### Ask students

> "If the app freezes on mouse movement, what would you expect to see if the renderer were guilty?"

Then explain:

- we looked
- we instrumented
- the expected renderer evidence did not appear

### Main teaching point

Negative evidence is evidence.

## 6. Step 4: Measure Which Electron Process Is Busy

Reference:

- `notes/electron-freeze-step-4-process-metrics.md`

### Show

Explain the Electron process model:

- `Browser`
- `Tab`
- `GPU`
- `Utility`

### Show one representative metrics line

Point out the pattern:

- `Browser` active
- `Tab` mostly quiet

### Ask students

> "If the visible window looks frozen, but the renderer is quiet, what does that suggest?"

### Main teaching point

A symptom in the UI does not imply causation in the renderer.

## 7. Step 5: Capture Native macOS Stack Samples

Reference:

- `notes/electron-freeze-step-5-native-sampling.md`

### Show

Walk through:

1. find the Electron browser/main PID
2. find its child processes
3. run `sample` on browser, renderer, and GPU

### Commands

Example pattern:

```bash
pgrep -af "Electron dist-electron/electron/main.js|scripts/run-dev.mjs|yarn.js dev-run:raw"
pgrep -P <electron-browser-pid> -af .
sample <browser-pid> 5 -file /tmp/electron-browser.sample.txt
```

### What to search for

- `uv_fs_event`
- `FSEventStream`
- `uv_sem_wait`
- `AppKit`
- `Metal`

### Ask students

> "Why use an OS tool here instead of just adding more JavaScript logs?"

### Main teaching point

When one layer goes quiet, drop down a layer.

## 8. Step 6: Search the Codebase for Watchers

Reference:

- `notes/electron-freeze-step-6-codebase-search-watchers.md`

### Run

```bash
rg "chokidar|fs\\.watch|watch\\(|FSEvents|watcher" src
```

### Show

Open:

- `src/server/sourceWatchHub.ts`
- `src/server/volumeWatchHub.ts`

### Ask students

> "Which of these feels more dangerous on a machine with huge Dropbox or iCloud folders?"

Expected answer:

- `SourceWatchHub`

### Main teaching point

Search should be driven by runtime evidence, not by random curiosity.

## 9. Step 7: Add Watcher Logs, Confirm the Cause, and Apply the Fix

Reference:

- `notes/electron-freeze-step-7-watch-lifecycle-and-fix.md`

### Show

Explain the goal:

> "We no longer want a suspicion. We want the app itself to name the subsystem, the watched paths, and the exact error."

### Watch for logs like

```text
[source-watch] created watcher #1; targets=["...Dropbox","...CloudDocs","...MEGA"] depth=3
[source-watch] watcher #1 error: EMFILE: too many open files, watch
```

### Then show the fix

Narrow targets from whole provider roots to:

- `Dropbox/nearbytes`
- `CloudDocs/nearbytes`
- `MEGA/nearbytes`

### Verification

Show that:

- `EMFILE` disappears
- watcher targets become narrow
- browser CPU falls back toward idle after reconcile

### Ask students

> "Why is narrowing the watch scope better than just suppressing the error?"

### Main teaching point

The best fix explains the evidence and preserves the feature.

## 10. Wrap-Up Discussion

### Prompt 1

> "At what point in the lesson did the original renderer hypothesis become weak?"

### Prompt 2

> "Which step changed the direction of the investigation the most?"

### Prompt 3

> "What made the final diagnosis stronger than a plausible guess?"

### Prompt 4

> "What role did AI play well here, and what role did it not play?"

## Recommended File Order During Class

If you want a simple instructor workflow:

1. `notes/electron-freeze-case-study.md`
2. `notes/electron-freeze-step-1-startup-deterministic.md`
3. `notes/electron-freeze-step-2-window-lifecycle.md`
4. `notes/electron-freeze-step-3-renderer-console-and-diagnostics.md`
5. `notes/electron-freeze-step-4-process-metrics.md`
6. `notes/electron-freeze-step-5-native-sampling.md`
7. `notes/electron-freeze-step-6-codebase-search-watchers.md`
8. `notes/electron-freeze-step-7-watch-lifecycle-and-fix.md`
9. `notes/electron-freeze-session-timeline.md`
10. `notes/electron-freeze-edit-sequence.md`

## If You Need a Shorter Version

For a `30-40 minute` version, use:

- symptom framing
- Step 2
- Step 4
- Step 5
- Step 6
- Step 7
- wrap-up

Skip most of:

- early startup cleanup detail
- edit sequence detail
- conversation reconstruction

## If You Need a More Reflective Version

For a seminar-style class, spend more time on:

- `notes/electron-freeze-session-timeline.md`
- `notes/electron-freeze-conversation-reconstruction.md`
- `notes/electron-freeze-edit-sequence.md`

This version is good for discussing:

- how hypotheses evolve
- how users shape debugging
- how instrumentation changes understanding

## Further Reading

For students who want to go further:

- `notes/electron-freeze-case-study.md`
- `notes/electron-freeze-session-timeline.md`
- `notes/electron-freeze-restarts-and-runs.md`
- `notes/electron-freeze-edit-sequence.md`
- `notes/electron-freeze-conversation-reconstruction.md`

Topics worth reading about afterward:

- Electron multi-process architecture
- libuv and filesystem watchers
- macOS FSEvents
- observability and diagnosability in desktop applications
- debugging methodology in complex systems
