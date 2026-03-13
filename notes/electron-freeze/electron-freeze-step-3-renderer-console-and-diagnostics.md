# Step 3 Lab: Redirect Renderer Console and Add Diagnostics

## Goal

Test whether the freeze is caused by renderer-side JavaScript: uncaught errors, promise rejections, long tasks, or slow pointer handlers.

## What This Step Teaches

- When DevTools is hard to use, redirecting renderer logs to the main terminal is extremely valuable.
- Negative evidence is powerful: if you instrument the suspected layer and it stays quiet, that tells you something important.

## Hypothesis Under Test

Maybe the app freezes because:

- a `mousemove` or `pointermove` handler is too slow
- the renderer throws when the mouse enters some area
- a promise rejection breaks the UI
- a long task blocks the renderer main thread

## Files To Inspect

- `electron/main.ts`

## Technique 1: Forward Renderer Console

Add a `console-message` hook:

```ts
window.webContents.on('console-message', (_event, level, message, line, sourceId) => {
  console.log(`[renderer:${level}] ${sourceId}:${line} ${message}`);
});
```

This sends browser console output into the Electron terminal.

## How We Used This In Practice

The practical problem was:

- the browser version of the app was available
- the Electron app was the one freezing
- opening DevTools reliably inside the stuck desktop app was not a good assumption

So the first move was to make the Electron terminal behave like a browser console sink.

That let us read:

- Vite connection logs
- runtime warnings
- Svelte/frontend console output
- anything emitted by the renderer diagnostics harness

without depending on a healthy Electron DevTools session.

## Technique 2: Inject Renderer Diagnostics

After `did-finish-load`, inject JavaScript that logs:

- `window` errors
- `unhandledrejection`
- slow pointer/mouse/wheel handlers
- long tasks
- frame gaps
- timer drift / main-thread stalls

## Why These Particular Signals

Each signal was chosen to test a different renderer-failure theory:

- `window` errors: maybe the app throws on interaction
- `unhandledrejection`: maybe an async call breaks the UI silently
- slow pointer/mouse/wheel handlers: maybe moving the mouse triggers expensive work
- long tasks: maybe the renderer is blocking the main thread
- frame gaps: maybe rendering stalls even if event handlers are quiet
- timer drift: maybe the event loop is blocked without a clean exception

In other words, this step was designed to test the intuitive story:

> "The app freezes when I move the mouse, so maybe the renderer is doing something bad on mouse events."

## Concrete Run Procedure

1. Start the app:

```bash
yarn dev-run --kill
```

2. Wait for:

- Vite to connect
- Electron to log `dom-ready`
- Electron to log `did-finish-load`

3. Confirm the diagnostics harness installed:

```text
[diag] renderer diagnostics installed
```

4. Interact with the Electron window in the way that usually causes the freeze.

5. Watch the terminal instead of the browser UI.

## Reproduction Run

```bash
yarn dev-run --kill
```

Then interact with the Electron window and try to trigger the freeze.

## What To Look For

If the renderer is the culprit, expect logs like:

- `[diag] slow-event-handler`
- `[diag] long-task`
- `[diag] main-thread-stall`
- `[diag] frame-gap`
- `[diag] window-error`
- `[diag] unhandled-rejection`

The most important question is not "Did anything log?"

It is:

> "Did the logs explain the freeze at the moment it happened?"

## What We Actually Saw

In the case study, we saw healthy renderer startup logs such as:

```text
[renderer:0] ... [vite] connecting...
[renderer:0] ... [vite] connected.
[desktop] renderer dom-ready
[desktop] window ready-to-show
[desktop] renderer did-finish-load
[diag] renderer diagnostics installed
```

But we did **not** see:

- a slow pointer handler
- a burst of long-task logs
- an unhandled rejection tied to the freeze
- a clean renderer-side exception explaining the beachball

## What Happened In The Case Study

Those logs did **not** appear at the time of freezing.

That was a critical clue. It meant:

- no obvious renderer exception
- no visible slow pointer handler
- no clearly logged renderer stall

## Why This Negative Result Was So Valuable

This was not a failed step. It was a successful elimination step.

It told us:

- the renderer loaded normally
- the frontend was not obviously crashing
- the most obvious mouse-handler theory was unsupported

That pushed the investigation away from:

- Svelte component logic
- DOM event handlers
- browser-only code

and toward:

- Electron process attribution
- native sampling
- backend/runtime infrastructure inside Electron

## Why This Matters

Students often think debugging means "find the error message." But in real systems, an absence of expected evidence can be just as informative.

In this case, the quiet renderer diagnostics pushed the investigation away from:

- Svelte component bugs
- pointer handlers
- browser-only JavaScript logic

and toward a lower-level explanation.

## Minimal Classroom Version

If you want the shortest live demo of this step:

1. Add renderer console forwarding.
2. Add one or two high-value diagnostics such as:
   - `window.onerror`
   - `unhandledrejection`
   - slow pointer handler logging
3. Trigger the freeze.
4. Ask students:

> "If the UI feels frozen, why are the renderer logs still quiet?"

That question naturally motivates the next step.

## Takeaways

### Low-level / systems takeaway

The visible window is only one layer of the system. A frozen-feeling UI does not imply that the browser/renderer event loop is the actual bottleneck; other processes or OS subsystems may be responsible.

### Debugging takeaway

Negative evidence is real evidence. If the suspected layer is instrumented well and remains quiet, that is a strong signal to move elsewhere rather than to keep staring at the same hypothesis.

### AI-tooling takeaway

AI can help quickly design broad but structured diagnostics: uncaught errors, rejections, slow handlers, long tasks, stalls. This is a good example of using AI to build investigative tools, not just to guess causes.

### Software development takeaway

Applications benefit from having diagnosability built in. Being able to route renderer logs to a stable terminal sink is a practical engineering improvement, not just a debugging trick.

## Discussion Prompt

Ask students:

> Why is a silent renderer log sometimes more informative than a noisy one?
