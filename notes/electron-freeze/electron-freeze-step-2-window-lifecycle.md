# Step 2 Lab: Instrument Electron Window Lifecycle

## Goal

Determine whether the desktop app is failing during load, crashing the renderer, or successfully reaching first paint.

## What This Step Teaches

- You should separate "window did not open" from "window opened and froze later".
- Lifecycle instrumentation is a fast way to cut down the hypothesis space.

## Hypothesis Under Test

Maybe the freeze was actually one of these:

- the page never finished loading
- the renderer crashed
- the preload bridge failed
- the window was never shown

## Files To Inspect

- `electron/main.ts`

## Instrumentation To Add

Log these events on `window.webContents` or `BrowserWindow`:

- `dom-ready`
- `ready-to-show`
- `did-finish-load`
- `did-fail-load`
- `render-process-gone`
- `unresponsive`

## How We Used This In Practice

This step came after startup had been made stable enough to trust.

At that moment, the key question was:

> "Is the app failing before first paint, or is it loading successfully and getting stuck later?"

That is exactly what lifecycle instrumentation answers quickly.

## Example Pattern

```ts
window.on('unresponsive', () => {
  console.error('[desktop] window became unresponsive');
});

window.once('ready-to-show', () => {
  console.log('[desktop] window ready-to-show');
  presentWindow(window);
});

window.webContents.on('dom-ready', () => {
  console.log('[desktop] renderer dom-ready');
});

window.webContents.on('did-finish-load', () => {
  console.log('[desktop] renderer did-finish-load');
});

window.webContents.on('did-fail-load', (_event, code, description, url) => {
  console.error('[desktop] renderer did-fail-load', code, description, url);
});

window.webContents.on('render-process-gone', (_event, details) => {
  console.error('[desktop] renderer process gone', details);
});
```

## Run

```bash
yarn dev-run --kill
```

## What We Actually Watched For

We were looking for a sequence like:

```text
[desktop] renderer dom-ready
[desktop] window ready-to-show
[desktop] renderer did-finish-load
```

and, just as importantly, the absence of:

- `did-fail-load`
- `render-process-gone`
- `unresponsive`

That combination means:

- the renderer is alive
- the page finished loading
- the window reached a presentable state

## Why This Step Was So Important

Before this instrumentation, several very different problems were still plausible:

- the UI URL might fail to load
- the renderer might die on startup
- the window might exist but never be shown
- the preload/runtime bridge might kill the app early

After this instrumentation, the hypothesis space became much smaller.

## What Students Should Watch For

Healthy output looks like:

```text
[desktop] renderer dom-ready
[desktop] window ready-to-show
[desktop] renderer did-finish-load
```

That is what we saw in the session, and it was one of the first signs that the "desktop app is dead on load" story was probably wrong.

## Interpretation

If those events all fire:

- the page loaded
- the renderer did not die immediately
- the window was at least ready to be presented

That means the freeze is likely **after** initial load, not before it.

## Minimal Classroom Version

For a quick in-class demo:

1. add the lifecycle logs
2. run the app
3. show students the successful lifecycle sequence
4. ask:

> "If the page finished loading, what explanations should we stop prioritizing?"

That question sets up the shift from startup diagnosis to runtime diagnosis.

## Takeaways

### Low-level / systems takeaway

Desktop applications have lifecycle states that matter: window creation, renderer load, compositor readiness, and process survival are distinct phases. Treating them as separate states gives much better visibility into what the system is doing.

### Debugging takeaway

One of the fastest ways to narrow a bug is to ask where in the lifecycle it occurs. A few well-placed event logs can eliminate whole families of explanations.

### AI-tooling takeaway

AI is especially useful for proposing targeted instrumentation when the human already knows the important state transitions to observe. The best prompts here are event-oriented and falsifiable: "tell me if the renderer ever reaches `did-finish-load`."

### Software development takeaway

Lifecycle hooks are not only useful in debugging; they are a sign of maintainable architecture. When the app has explicit presentation and readiness boundaries, both development and support become easier.

## Teaching Point

This step is about ruling out the most obvious class of explanations.

You are not proving what the bug is yet. You are proving what it is **not**.

## Discussion Prompt

Ask students:

> If `did-finish-load` fires successfully, what entire family of explanations becomes less likely?
