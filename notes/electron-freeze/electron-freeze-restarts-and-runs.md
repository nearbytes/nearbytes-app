# Electron Freeze Restarts and Runs

## Purpose

This note records the major restart attempts and their outcomes during the debugging session.

It is useful for teaching because it shows how repeated controlled runs refine the hypothesis space.

## Major Runs

### Run A

- Start time: `2026-03-13T17:46:35.859Z`
- Command: `yarn dev-run --kill`

Observed:

- Vite came up
- Electron hit a UI-state persistence error during startup

Key clue:

- a state-file write path needed cleanup or race protection

### Run B

- Start time: `2026-03-13T17:47:32.371Z`
- Command: `yarn dev-run --kill`

Observed:

- startup moved past the original rename error
- malformed or partially written UI-state content still caused warnings

### Run C

- Start time: `2026-03-13T17:48:03.423Z`
- Command: `yarn dev-run --kill`

Observed:

- startup looked clean
- Vite and Electron stayed up

### Run D

- Start time: `2026-03-13T17:51:39.682Z`
- Command: `yarn dev-run --kill`

Observed:

- clean Vite bind on `5173`
- used to verify startup after clearing stale port conflicts

### Run E

- Start time: `2026-03-13T17:57:03.983Z`
- Command: `yarn dev-run --kill`

Observed:

- run after explicit window `show()` / `focus()` / macOS `activate` changes

### Run F

- Start time: `2026-03-13T18:03:23.995Z`
- Command: `yarn dev-run --kill`

Observed:

- first renderer console forwarding
- first window lifecycle logs

### Run G

- Start time: `2026-03-13T18:15:27.589Z`
- Command: `yarn dev-run --kill`

Observed:

- renderer diagnostics harness installed
- renderer CPU profiling started

### Run H

- Start time: `2026-03-13T18:18:27.755Z`
- Command: `yarn dev-run --kill`

Observed:

- app metrics logging active
- live freeze investigation run
- later used with native `sample`

### Run I

- Start time: `2026-03-13T18:22:05.550Z`
- Command: `yarn dev-run --kill`

Observed:

- watch-lifecycle instrumentation active
- decisive `EMFILE: too many open files, watch` evidence

### Run J

- Start time: `2026-03-13T18:23:42.703Z`
- Command: `yarn dev-run --kill`

Observed:

- narrowed watch targets
- no `EMFILE` flood
- watcher ready logs were clean
- fix verification run

## Pattern Across Runs

The runs naturally grouped into phases:

1. startup cleanup
2. window lifecycle validation
3. renderer instrumentation
4. process attribution
5. native sampling
6. watcher proof
7. fix validation

## Teaching Point

Students often imagine debugging as:

- one run
- one error message
- one fix

This session shows the real shape of debugging:

- many controlled reruns
- each run answering one narrower question

## Takeaways

### Low-level / systems takeaway

Repeated runs are not redundant when debugging systems code. Each restart resets process state, port state, watcher state, and app lifecycle state, which can drastically change what you observe.

### Debugging takeaway

Good debugging often looks repetitive from the outside, but each rerun should answer a different question. The important distinction is between random repetition and controlled experimentation.

### AI-tooling takeaway

AI can help keep reruns purposeful by tracking what changed between runs and what hypothesis each run was meant to test. This prevents the session from becoming a blur of "try again" loops.

### Software development takeaway

Reliable restart workflows are part of developer experience. Tooling like `yarn dev-run --kill` is not just convenience; it makes iterative diagnosis much more practical.
