# Step 4 Lab: Measure Which Electron Process Is Busy

## Goal

Determine whether the freeze is happening in the Electron renderer, browser/main process, GPU process, or utility process.

## What This Step Teaches

- Electron is multi-process.
- A UI freeze does not automatically mean "renderer problem."
- Process-level telemetry can redirect the entire investigation.

## Hypothesis Under Test

Which process is actually doing work when the app feels frozen?

## File To Inspect

- `electron/main.ts`

## Instrumentation

Log `app.getAppMetrics()` once per second:

```ts
setInterval(() => {
  const metrics = app.getAppMetrics().map((entry) => ({
    pid: entry.pid,
    type: entry.type,
    cpuPercent: Number(entry.cpu.percentCPUUsage.toFixed(1)),
  }));
  console.log(`[desktop] app-metrics ${JSON.stringify(metrics)}`);
}, 1000);
```

## How We Used This In Practice

This step came right after the renderer diagnostics stayed mostly quiet.

At that point, the question changed from:

> "What exception is the renderer throwing?"

to:

> "Which Electron process is actually under load?"

That is exactly the kind of question `app.getAppMetrics()` answers well.

## Why `app.getAppMetrics()` Was the Right Tool

Electron separates work across multiple processes. A freeze in the visible window might come from:

- the `Tab` renderer process
- the `Browser` main process
- the `GPU` process
- a utility/network process

If you skip this step, it is easy to keep staring at frontend code when the problem is elsewhere.

## Concrete Run Procedure

1. Add the metrics logger in `electron/main.ts`.
2. Start the app:

```bash
yarn dev-run --kill
```

3. Let the app reach its normal loaded state.
4. Trigger the freeze or the suspicious interaction.
5. Watch the metrics lines in the terminal.

## How To Read the Output

The log lines look like:

```text
[desktop] app-metrics [{"pid":29976,"type":"Browser","cpuPercent":13.5},{"pid":30004,"type":"Tab","cpuPercent":0.3}]
```

Students should focus on:

- which process type is consistently active
- whether the renderer (`Tab`) is quiet or busy
- whether the browser/main process is unexpectedly non-idle

## What We Actually Saw

During the investigation, the key pattern was:

- `Browser` process around `11-15%` CPU
- `Tab` renderer process near idle

That was the opposite of what you would expect from a normal "mouse handler in the UI is freezing the app" story.

## Why This Was a Turning Point

This changed the working model of the bug.

Before metrics:

- the renderer was still the main suspect

After metrics:

- the Electron browser/main process became the leading suspect

That is a major hypothesis shift, and students should see how a small amount of telemetry can justify it.

## Reproduction Run

```bash
yarn dev-run --kill
```

Trigger the freeze, then read the terminal output.

## What To Look For

Key process types:

- `Browser`
- `Tab`
- `GPU`
- `Utility`

Questions for students:

- Is the `Tab` renderer process busy?
- Is the `Browser` process unexpectedly busy?
- Is the `GPU` process spiking?

## Example Interpretation Exercise

Give students a line like:

```text
[desktop] app-metrics [{"pid":61669,"type":"Browser","cpuPercent":12.1},{"pid":61821,"type":"Tab","cpuPercent":0.2}]
```

Ask:

1. Which process is busy?
2. What hypothesis becomes weaker?
3. What subsystem would you inspect next?

Expected answer:

- the `Browser` process is busy
- a pure renderer event-handler explanation becomes weaker
- inspect main-process code, runtime services, or OS-facing subsystems

## What Happened In The Case Study

The striking pattern was:

- the `Tab` process remained near idle
- the `Browser` process showed sustained activity

This changed the theory from:

> "The renderer is freezing."

to:

> "The main/browser process is under load, and the UI is suffering as a consequence."

## Minimal Classroom Version

For a short lecture demo:

1. Add `app.getAppMetrics()` logging.
2. Start the app and reproduce the freeze.
3. Show students one or two metrics lines.
4. Ask:

> "If the window looks frozen, but the renderer is quiet, where should we look next?"

That naturally motivates native sampling and codebase search.

## Takeaways

### Low-level / systems takeaway

Electron is a multi-process system. CPU and responsiveness are distributed across browser, renderer, GPU, and utility processes, so performance and freeze diagnosis often require process attribution rather than single-thread thinking.

### Debugging takeaway

Before diving deeper into code, identify which process is actually busy. Good debugging often begins with attribution: who is doing the work, and who is merely showing the symptom?

### AI-tooling takeaway

AI is especially effective when paired with concrete runtime telemetry. Instead of asking the model to speculate, give it process metrics and ask it to interpret a pattern. That produces much better reasoning.

### Software development takeaway

Operational visibility should be part of the product, even in development builds. Small telemetry hooks such as per-process metrics can drastically shorten debugging cycles in complex applications.

## Why This Was Important

This step prevented wasted effort in the wrong layer.

If students only inspect frontend code, they may spend an hour reading Svelte components while the real bug lives in:

- Electron main-process code
- backend runtime code inside Electron
- OS-facing infrastructure like filesystem watchers

## Discussion Prompt

Ask students:

> Why is process attribution often more useful than a stack trace at the beginning of a multi-process debugging session?
