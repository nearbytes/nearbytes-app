# Electron Freeze Edit Sequence

## Purpose

This note reconstructs the order of code edits made during the debugging session and explains what each edit was meant to test or fix.

This is useful in class because it shows that edits during debugging are often:

- provisional
- investigative
- layered
- not all part of the final root-cause fix

## Edit Sequence

### 1. `electron/uiState.ts`

Change:

- switched desktop UI-state temp writes from a shared temp filename to a unique temp filename

Why:

- to eliminate a startup race in UI-state persistence

Status:

- important startup stabilization fix
- not the final freeze root cause

### 2. `electron/main.ts`

Change:

- improved window presentation
- explicit `show()` / `focus()`
- macOS `activate` handler

Why:

- to ensure the Electron window actually appeared and could be re-opened from the dock

Status:

- useful stabilization
- not the final freeze root cause

### 3. `electron/main.ts`

Change:

- added window lifecycle logs:
  - `dom-ready`
  - `ready-to-show`
  - `did-finish-load`
  - `did-fail-load`
  - `render-process-gone`
  - `unresponsive`

Why:

- to determine whether the app was crashing or freezing before/after load

Status:

- instrumentation only

### 4. `electron/main.ts`

Change:

- forwarded renderer console output to the terminal

Why:

- to get browser-style logs even when the desktop UI was inaccessible

Status:

- instrumentation only

### 5. `electron/main.ts`

Change:

- injected renderer diagnostics for:
  - uncaught errors
  - unhandled rejections
  - slow event handlers
  - long tasks
  - frame gaps
  - stalls

Why:

- to directly test the hypothesis that the renderer mouse handlers were freezing the app

Status:

- instrumentation only

### 6. `electron/main.ts`

Change:

- added Electron process metrics logging using `app.getAppMetrics()`

Why:

- to determine which Electron process was actually busy

Status:

- instrumentation only

### 7. `electron/main.ts`

Change:

- added renderer CPU profiling and later changed it to be optional

Why:

- to capture deeper renderer evidence
- later reduced to avoid polluting native samples

Status:

- instrumentation only

### 8. `src/server/sourceWatchHub.ts`

Change:

- added source-watch lifecycle logs:
  - watcher creation
  - reuse
  - readiness
  - unsubscribe
  - close timing
  - watcher errors

Why:

- to directly test whether source watching was the overloaded subsystem

Status:

- decisive instrumentation

### 9. `src/server/volumeWatchHub.ts`

Change:

- added analogous logs for volume-watch lifecycle

Why:

- to compare volume watching against source watching

Status:

- supporting instrumentation

### 10. `ui/src/lib/api.ts`

Change:

- added client-side logs for source-watch and volume-watch connections

Why:

- to connect renderer-side behavior with server-side watcher creation

Status:

- decisive instrumentation

### 11. `src/server/sourceWatchHub.ts`

Change:

- changed the source watch plan from broad cloud roots to narrow Nearbytes candidate directories

Before:

- watched entire provider roots such as Dropbox, iCloud Drive, and MEGA

After:

- watched paths such as:
  - `.../Dropbox/nearbytes`
  - `.../CloudDocs/nearbytes`
  - `.../MEGA/nearbytes`

Why:

- to remove watcher overload while preserving the discovery feature

Status:

- final root-cause fix

### 12. `src/server/__tests__/sourceWatchHub.test.ts`

Change:

- updated test fixtures to match the renamed source resolver used by the new watch-plan logic

Why:

- to restore a clean build after the fix

Status:

- supporting maintenance edit

### 13. `notes/*.md`

Change:

- wrote documentation, classroom notes, and case-study material

Why:

- to preserve the debugging story and turn it into teaching material

## Final Classification

Edits in this session fall into three categories:

### Startup stabilization

- `electron/uiState.ts`
- early `electron/main.ts` window-lifecycle fixes

### Investigative instrumentation

- lifecycle logging
- console forwarding
- renderer diagnostics
- process metrics
- CPU profiling
- watcher lifecycle logging

### Root-cause fix

- narrowing `SourceWatchHub` targets from huge provider roots to `nearbytes` candidate directories

## Teaching Point

Not every edit made during debugging is "the fix."

Many edits are scientific instruments:

- they produce evidence
- they rule out explanations
- they justify the final repair

## Takeaways

### Low-level / systems takeaway

When debugging systems that cross UI, runtime, and OS layers, many useful edits are not feature changes at all. They are instrumentation changes that expose the behavior of lower layers.

### Debugging takeaway

Not every code change during debugging is supposed to survive forever. Some edits are probes. A mature debugging process distinguishes between exploratory instrumentation and the final production fix.

### AI-tooling takeaway

AI is especially strong at generating small, temporary instrumentation edits quickly. This is one of the best uses of AI in debugging: turning a hypothesis into observable signals with minimal manual overhead.

### Software development takeaway

A healthy development workflow tolerates temporary instrumentation, targeted experiments, and cleanup. Teams that cannot safely make and evaluate investigative edits will debug more slowly and with less confidence.
