# Electron Freeze Session Timeline

## Purpose

This note reconstructs the debugging session as a timeline suitable for class discussion.

It is based on:

- terminal `started_at` timestamps
- observed command output
- edit order in the repository
- the conversation flow from the debugging session

It is **not** a perfect machine-generated transcript. Some timestamps are exact, and some durations are inferred from nearby runs and edits.

## High-Level Window

- Approximate session start: `2026-03-13 17:46:35Z`
- Approximate session end of root-cause verification: `2026-03-13 18:23:42Z`
- Approximate total active debugging time: `37 minutes`

## Chronological Timeline

### 17:46:35Z

First controlled run of:

```bash
yarn dev-run --kill
```

Observed:

- Vite started
- Electron startup hit a desktop UI-state persistence error involving rename/temporary files

Interpretation:

- the app was not yet in a clean enough state to debug the freeze itself

### 17:47:32Z

Restart after UI-state write changes.

Observed:

- startup progressed further
- corrupted or partially written UI-state content still caused warnings

Interpretation:

- the race or state-file issue was being cleaned up
- still not the final freeze root cause

### 17:48:03Z

Fresh verification run after cleanup.

Observed:

- Vite and Electron launched without the previous state-file exception

Interpretation:

- startup became stable enough to continue

### 17:51Z

Port-conflict investigation.

Observed:

- some earlier runs failed because port `5173` was already in use
- stale or unrelated listeners had to be cleared

Interpretation:

- this was startup noise, not the freeze root cause

### 17:57:03Z

Window lifecycle/presentation patch run.

Observed:

- Electron window lifecycle was instrumented
- explicit show/focus and macOS `activate` handling were added

Interpretation:

- this reduced ambiguity about whether the window existed but was hidden, off-screen, or unfocused

### 18:03:23Z

Renderer lifecycle diagnostics run.

Observed:

- `dom-ready`
- `ready-to-show`
- `did-finish-load`
- renderer console forwarding

Interpretation:

- the renderer was loading successfully
- no obvious startup crash

### 18:15:27Z

Renderer diagnostic harness plus CPU profiling run.

Observed:

- renderer diagnostics installed
- renderer CPU profile started

Interpretation:

- this tested the hypothesis that pointer/mouse handlers or renderer long tasks were causing the freeze

### 18:18:27Z

Live freeze investigation with process metrics.

Observed:

- Electron `Browser` process showed notable activity
- `Tab` renderer process remained relatively quiet

Interpretation:

- attention shifted from the renderer to the Electron browser/main process

### 18:19Z to 18:20Z

Native macOS process sampling during the live freeze.

Sampled:

- browser process
- renderer process
- GPU process

Observed in samples:

- `uv_fs_event_stop`
- `uv__fsevents_close`
- `FSEventStream...`
- `uv_sem_wait`

Interpretation:

- strong indication that filesystem watcher churn or overload was involved

### 18:20Z to 18:22Z

Codebase search for watcher infrastructure.

Observed:

- `SourceWatchHub`
- `VolumeWatchHub`
- `chokidar` usage

Interpretation:

- `SourceWatchHub` became the leading suspect because it watched broad cloud roots

### 18:22:05Z

Watch-lifecycle instrumentation run.

Observed:

- source-watch client open logs
- watcher creation logs
- watcher target logs
- repeated errors:

```text
EMFILE: too many open files, watch
```

and targets like:

- `Dropbox`
- `CloudDocs`
- `MEGA`

Interpretation:

- this was the decisive proof

### 18:23:42Z

Run after narrowing watch targets to:

- `Dropbox/nearbytes`
- `CloudDocs/nearbytes`
- `MEGA/nearbytes`

Observed:

- watcher started cleanly
- no `EMFILE` flood
- browser CPU dropped back toward idle after initial reconcile

Interpretation:

- fix confirmed

## Step Durations

These are approximate and rounded for teaching:

- Step 1, startup stabilization: `~5 minutes`
- Step 2, window lifecycle instrumentation: `~10-12 minutes`
- Step 3, renderer console + diagnostics: `~12 minutes`
- Step 4, process metrics: `~3 minutes`
- Step 5, native sampling: `~4 minutes`
- Step 6, watcher code search: `~3-4 minutes`
- Step 7, watcher logs + fix verification: `~5 minutes`

## Suggested Classroom Use

This note works well as:

- a lecture timeline
- a systems-debugging postmortem
- a prompt for students to ask, at each stage, "What hypothesis was just ruled out?"

## Takeaways

### Low-level / systems takeaway

Systems bugs often reveal themselves over time rather than all at once. The order in which signals appear matters, because different subsystems become visible at different stages of execution.

### Debugging takeaway

A timeline is not just documentation; it is a reasoning tool. Reconstructing when each clue appeared helps explain why certain hypotheses were reasonable earlier and unreasonable later.

### AI-tooling takeaway

AI can help synthesize a coherent timeline from scattered evidence such as terminal timestamps, edit sequences, and observed outcomes. This is especially useful after a complex session with many overlapping substeps.

### Software development takeaway

Teams benefit from turning messy debugging sessions into clear temporal narratives. A timeline helps future developers understand not just what the bug was, but how the investigation unfolded and why the final explanation was credible.
