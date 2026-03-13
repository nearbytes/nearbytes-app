# Case Study: Hunting an Electron Freeze

## Summary

This note documents a real debugging session in the Nearbytes desktop app. The visible symptom looked like a classic GUI/rendering problem: the Electron app opened, the browser version worked, but the desktop app beachballed and the pointer turned into a spinner when the mouse moved over the app.

The actual root cause was not a renderer mouse handler at all. The Electron **browser/main process** was being overloaded by recursive filesystem watchers created for huge cloud-storage roots such as Dropbox, iCloud Drive, and MEGA. This led to repeated `EMFILE: too many open files, watch` errors and AppKit/FSEvents pressure severe enough to make the desktop app appear frozen.

If you want a more narrative version, see: [A Short Story: The Electron Freeze](./electron-freeze-story.md)

## Lab Starting Point

To reproduce this lab from the same repository state, start from commit:

- [`07aa249b306c436a3973add886f9a914782770bc`](https://github.com/nearbytes/nearbytes-app/commit/07aa249b306c436a3973add886f9a914782770bc)

## Reproducible Lab Guides

Use these handouts to reproduce each stage of the investigation in class:

1. [Step 1: Make Startup Deterministic](./electron-freeze-step-1-startup-deterministic.md)
2. [Step 2: Instrument Electron Window Lifecycle](./electron-freeze-step-2-window-lifecycle.md)
3. [Step 3: Redirect Renderer Console and Add Diagnostics](./electron-freeze-step-3-renderer-console-and-diagnostics.md)
4. [Step 4: Measure Which Electron Process Is Busy](./electron-freeze-step-4-process-metrics.md)
5. [Step 5: Capture Native macOS Stack Samples](./electron-freeze-step-5-native-sampling.md)
6. [Step 6: Search the Codebase for Filesystem Watchers](./electron-freeze-step-6-codebase-search-watchers.md)
7. [Step 7: Add Watcher Logs, Confirm the Cause, and Apply the Fix](./electron-freeze-step-7-watch-lifecycle-and-fix.md)

Related reconstruction notes:

- [Lesson Plan](./electron-freeze-lesson-plan.md)
- [Session Timeline](./electron-freeze-session-timeline.md)
- [Restarts and Runs](./electron-freeze-restarts-and-runs.md)
- [Edit Sequence](./electron-freeze-edit-sequence.md)
- [Conversation Reconstruction](./electron-freeze-conversation-reconstruction.md)

## Session Timeline

These times are reconstructed from terminal `started_at` timestamps and edit history, not from a perfect per-message chat transcript. They are good approximations for teaching, but several substeps overlapped.

- Total active debugging time: about 37 minutes
- Approximate session window: `2026-03-13 17:46:35Z` to `2026-03-13 18:23:42Z`

Approximate time spent per step:

1. Step 1, make startup deterministic: about 5 minutes
2. Step 2, instrument window lifecycle and stabilize presentation: about 10 to 12 minutes
3. Step 3, redirect renderer console and add diagnostics: about 12 minutes
4. Step 4, measure Electron process activity: about 3 minutes
5. Step 5, capture native macOS stack samples: about 4 minutes
6. Step 6, search the codebase for watcher infrastructure: about 3 to 4 minutes
7. Step 7, add watcher logs, prove `EMFILE`, narrow watch scope, and verify the fix: about 5 minutes

## Why This Was Interesting

This bug is a good teaching example because:

- The symptom pointed in the wrong direction.
- The web app worked, which made the renderer look innocent.
- The bug only appeared in the Electron desktop environment.
- We had to combine application logs, process metrics, native process sampling, and architectural reading of the codebase to find it.
- Several early hypotheses were plausible but wrong.

## Initial Symptom

Observed behavior:

- `yarn dev-run` launched the app.
- The UI was reachable in the browser at `http://127.0.0.1:5173/`.
- Electron appeared in the dock.
- The Electron window either failed to appear, beachballed, or became stuck when interacting with it.

At first glance, this looked like one of:

- a renderer crash
- a bad preload bridge
- a `BrowserWindow` lifecycle bug
- a JavaScript event handler freezing on mouse movement
- a GPU/compositor issue

## Step 1: Make Startup Deterministic

Detailed lab guide: [Step 1 handout](./electron-freeze-step-1-startup-deterministic.md)

Before diagnosing the freeze, we had to stabilize startup:

- fixed a race in desktop UI-state persistence by switching from a shared temp file to a unique temp filename
- cleared stale port conflicts on `5173`
- improved window presentation with explicit `show()` / `focus()` and a macOS `activate` handler

This removed several misleading startup failures so we could focus on the real freeze.

## Step 2: Instrument Electron Window Lifecycle

Detailed lab guide: [Step 2 handout](./electron-freeze-step-2-window-lifecycle.md)

We added logs for:

- `dom-ready`
- `ready-to-show`
- `did-finish-load`
- `did-fail-load`
- `render-process-gone`
- `unresponsive`

Result:

- the renderer connected to Vite
- the page finished loading
- the window reached `ready-to-show`
- there was no renderer crash

This was the first major clue. The app was not failing during initial page load.

## Step 3: Redirect Renderer Console to the Terminal

Detailed lab guide: [Step 3 handout](./electron-freeze-step-3-renderer-console-and-diagnostics.md)

Because desktop-app debugging is much harder when DevTools is unavailable or the app is stuck, we forwarded renderer console output into the Node/Electron terminal.

We also injected a diagnostics harness to log:

- uncaught `window` errors
- unhandled promise rejections
- slow pointer/mouse/wheel handlers
- long tasks
- frame gaps
- main-thread stalls

This was useful detective work because it tested the most intuitive hypothesis directly:

> "Maybe a renderer event handler is freezing when the mouse moves."

But the logs did **not** show slow pointer handlers, JavaScript stalls, or renderer exceptions at the moment of freezing.

That negative result mattered a lot.

## Step 4: Measure Which Electron Process Was Busy

Detailed lab guide: [Step 4 handout](./electron-freeze-step-4-process-metrics.md)

We then logged Electron app metrics once per second using `app.getAppMetrics()`.

This gave per-process activity for:

- `Browser`
- `Tab`
- `GPU`
- `Utility`

The important pattern was:

- the `Tab` renderer process stayed near idle
- the `Browser` process showed sustained activity

That changed the working theory completely.

Instead of:

> "The renderer is freezing because of a mouse event."

we moved to:

> "The Electron main/browser process is under pressure, and the UI freeze is a secondary effect."

## Step 5: Capture Native Stack Samples While the App Was Frozen

Detailed lab guide: [Step 5 handout](./electron-freeze-step-5-native-sampling.md)

Once the app was stuck live, we captured macOS process samples from:

- the Electron browser process
- the Electron renderer process
- the Electron GPU process

This is a powerful technique when JavaScript logs are insufficient. Native samples can reveal whether a process is blocked in:

- AppKit event handling
- Metal/GPU calls
- filesystem watchers
- networking
- semaphores
- IPC

The browser-process sample was especially revealing. It showed heavy activity around:

- `uv_fs_event_stop`
- `uv__fsevents_close`
- `FSEventStream...`
- `uv_sem_wait`

This strongly suggested watcher churn or watcher overload in the Node/libuv side of Electron's main process.

## Step 6: Search the Codebase for File Watching

Detailed lab guide: [Step 6 handout](./electron-freeze-step-6-codebase-search-watchers.md)

Once the native sample implicated FSEvents, we searched the codebase for watcher logic and found:

- `src/server/sourceWatchHub.ts`
- `src/server/volumeWatchHub.ts`

Both used `chokidar`, but `SourceWatchHub` was especially suspicious because it watched broad scan roots for cloud providers.

The original source-watch plan used roots like:

- `~/Library/CloudStorage/Dropbox`
- `~/Library/Mobile Documents/com~apple~CloudDocs`
- `~/MEGA`

Those are enormous folders on many systems.

## Step 7: Add Domain-Specific Watcher Logs

Detailed lab guide: [Step 7 handout](./electron-freeze-step-7-watch-lifecycle-and-fix.md)

We then instrumented both the client and server watch lifecycle:

- when source watch opened
- when volume watch opened
- when a watcher was created
- when a watcher was reused
- when a watcher was closed
- how long closing took
- watcher errors

That produced the decisive evidence.

The terminal showed:

```text
[source-watch] created watcher #1; targets=["/Users/akurz/Library/CloudStorage/Dropbox","/Users/akurz/Library/Mobile Documents/com~apple~CloudDocs","/Users/akurz/MEGA"] depth=3
[source-watch] watcher #1 error: EMFILE: too many open files, watch
```

repeated many times.

At that point the case was essentially solved.

## Root Cause

The desktop app's source discovery feature was recursively watching very large synced-cloud roots.

That caused:

- too many filesystem watches to be requested
- repeated `EMFILE` errors
- heavy FSEvents/libuv activity in the Electron browser process
- degraded responsiveness or beachballing in the desktop app

The visible symptom was a stuck pointer and frozen app, but the underlying problem was resource exhaustion in filesystem watching.

## Why The Symptom Was Misleading

The bug looked like a mouse/UI bug because the freeze became noticeable when interacting with the window. But the actual problem was below the renderer:

- not a Svelte component problem
- not a renderer exception
- not a bad pointer handler
- not primarily a Vite/web app problem

The UI simply became the place where the overloaded main process was most obvious.

## The Fix

Instead of watching the entire provider roots, we changed source watching to target only the Nearbytes candidate directories:

- `.../Dropbox/nearbytes`
- `.../CloudDocs/nearbytes`
- `.../MEGA/nearbytes`

After that change:

- the watcher came up cleanly
- `EMFILE` errors disappeared
- browser-process CPU fell from about `12%` at startup to near idle after initial reconcile
- the diagnostics became quiet enough to trust again

## Debugging Techniques Used

This case used several debugging techniques in sequence:

1. **Stabilize unrelated startup failures first**
   Fixing unrelated issues reduced noise and prevented false conclusions.

2. **Instrument lifecycle events**
   Logging `ready-to-show`, `did-finish-load`, and crash hooks quickly separated "startup failure" from "post-load freeze."

3. **Forward renderer console to the terminal**
   Essential when the UI is inaccessible or DevTools cannot be used reliably.

4. **Add negative tests, not just positive ones**
   The absence of slow pointer-handler logs was a clue.

5. **Measure process-level behavior**
   Per-process Electron metrics told us the browser process was busier than the renderer.

6. **Sample native stacks during the failure**
   Native sampling exposed FSEvents/libuv activity that JavaScript-level logging could not see.

7. **Search for architectural matches in the code**
   Once the sample showed FSEvents, it was natural to inspect `chokidar` code paths.

8. **Add domain-specific logs at the suspected boundary**
   Logging watcher creation and errors turned suspicion into proof.

## Teaching Lessons

Good lessons for students:

- The first story the symptom suggests is often wrong.
- Debugging is often about shrinking the hypothesis space, not guessing better.
- Negative evidence is powerful.
- When JavaScript logging stops helping, drop down a level:
  process metrics, OS sampling, watcher traces, network traces, etc.
- Architecture matters. Understanding where Electron's browser process, renderer process, and backend runtime overlap was key.
- "Works in the browser" does not imply "the renderer is fine" in Electron. Desktop-specific infrastructure can still break the app.

## Short Version for Class

If you want a concise one-paragraph retelling:

> We debugged an Electron app that looked like it was freezing because of mouse movement in the UI. We first instrumented the renderer and window lifecycle, but found no renderer errors or slow mouse handlers. Process metrics then showed the Electron browser process, not the renderer, was doing the work. Native macOS stack samples pointed to FSEvents and libuv filesystem watcher activity. A code search found a `chokidar` source watcher recursively watching entire Dropbox, iCloud, and MEGA roots. Terminal logs then confirmed repeated `EMFILE: too many open files, watch` errors. Narrowing the watch targets to `nearbytes` subdirectories fixed the freeze.

## Files Involved

- `electron/main.ts`
- `src/server/sourceWatchHub.ts`
- `src/server/volumeWatchHub.ts`
- `ui/src/lib/api.ts`
- `src/config/sourceDiscovery.ts`

## Final Moral

The bug was found by treating debugging like detective work:

- gather evidence
- test a theory
- reject it if the evidence disagrees
- move one layer deeper
- instrument the next likely boundary
- keep narrowing until one explanation fits all the facts

That is often what real debugging feels like in systems that span UI, runtime, OS services, and external resources.

## Takeaways

### Low-level / systems takeaway

Modern desktop applications sit on top of many interacting layers: UI frameworks, browser engines, runtimes, operating-system event systems, filesystems, and cloud-synced directories. Bugs that look visual or interaction-based may actually be caused by low-level resource exhaustion.

### Debugging takeaway

Strong debugging is cumulative. Each step in this case did not magically "find the bug"; instead, each step removed one class of explanations or strengthened one line of evidence until only one explanation fit all the facts.

### AI-tooling takeaway

AI is most valuable when used as a structured debugging partner: propose instrumentation, compare hypotheses, interpret traces, and document the story. It is least useful when asked to guess the answer without evidence.

### Software development takeaway

Software engineering is not just feature building. Diagnosability, observability, and small targeted fixes are part of good design. The final fix worked because it aligned implementation detail with the true semantics of the feature.
