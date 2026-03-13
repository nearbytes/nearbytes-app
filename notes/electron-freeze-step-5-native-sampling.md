# Step 5 Lab: Capture Native macOS Stack Samples

## Goal

Inspect what the live Electron processes are doing at the OS/native level while the app is frozen.

## What This Step Teaches

- JavaScript logs are not enough for every bug.
- Native process sampling can reveal waits, OS APIs, and runtime subsystems that are invisible in app-level logs.

## Prerequisites

- macOS
- a live frozen Electron process
- Terminal access

## Why Use `sample`

The macOS `sample` tool captures stack snapshots over time. It is especially useful when:

- the UI is stuck
- the terminal logs are inconclusive
- you want to know whether a process is blocked in AppKit, Metal, libuv, filesystem watching, or IPC

## Find the Relevant PIDs

Example:

```bash
pgrep -af "Electron dist-electron/electron/main.js|scripts/run-dev.mjs|yarn.js dev-run:raw"
```

In this session, the important Electron parent process was the one running:

- `Electron dist-electron/electron/main.js`

That is the Electron **browser/main** process.

Then inspect the Electron child processes:

```bash
pgrep -P <electron-browser-pid> -af .
```

Typical helper processes:

- renderer
- GPU
- utility/network

## How We Used `sample` In Practice

This is the exact workflow we used during the live freeze.

### 1. Wait until the app is visibly stuck

Do **not** sample too early. The point of `sample` is to capture what the processes are doing while the failure is actually happening.

In this case, the user reported that:

- the Electron app was still running
- the pointer had become a spinner
- the app felt stuck

That was the right moment to sample.

### 2. Identify the Electron browser/main PID

Run:

```bash
pgrep -af "Electron dist-electron/electron/main.js|scripts/run-dev.mjs|yarn.js dev-run:raw"
```

Interpretation:

- `scripts/run-dev.mjs` is the launcher
- `yarn.js dev-run:raw` is the child process managing the two dev services
- `Electron dist-electron/electron/main.js` is the real Electron browser/main process

In the session, that browser/main PID was:

- `29976`

### 3. Identify the child helper processes

Run:

```bash
pgrep -P 29976 -af .
```

Then inspect the child PIDs if needed:

```bash
ps -p <pid1>,<pid2>,<pid3> -o pid=,ppid=,%cpu=,%mem=,etime=,stat=,command=
```

In the session, that let us distinguish:

- `30000` = GPU helper
- `30001` = utility/network helper
- `30004` = renderer helper

### 4. Sample each important process separately

We sampled each process for 5 seconds:

```bash
sample 29976 5 -file /tmp/nearbytes-electron-browser.sample.txt
sample 30004 5 -file /tmp/nearbytes-electron-renderer.sample.txt
sample 30000 5 -file /tmp/nearbytes-electron-gpu.sample.txt
```

Why 5 seconds?

- long enough to collect a meaningful stack profile
- short enough to be practical during a live failure
- easy for students to reproduce in class

### 5. Read the sample files

After `sample` finishes, macOS writes a plain-text report.

Read the top of the file first. Important fields include:

- process name
- PID
- parent process
- launch time
- physical footprint
- call graph

For example, the browser process sample began like this:

```text
Analysis of sampling Electron (pid 29976) every 1 millisecond
Process:         Electron [29976]
Parent Process:  node [29975]
```

That confirmed we had sampled the correct process.

### 6. Search the sample for subsystem clues

Once the file is created, search it for meaningful keywords:

```bash
rg "NSEvent|AppKit|Metal|uv_fs_event|FSEventStream|uv_sem_wait|mach_msg" /tmp/nearbytes-electron-browser.sample.txt
```

and similarly for the renderer and GPU sample files.

This is a good teaching moment:

- you are usually not reading every line
- you are using the sample to locate suspicious subsystems

## How To Read a Sample

The call graph is a statistical picture of where the sampled process spent its time during the capture window.

You are looking for patterns such as:

- AppKit event handling
- Metal/GPU compositor paths
- libuv I/O waits
- filesystem event APIs
- inspector/profiler overhead

The goal is **not** to understand every symbol.

The goal is to answer:

> Which subsystem keeps showing up in the stuck process?

## What We Saw In This Case

### Browser/main sample

This was the most informative sample.

Repeated patterns included:

- `uv_fs_event_stop`
- `uv__fsevents_close`
- `FSEventStreamStart`
- `FSEventStreamCreate`
- `uv_sem_wait`

Interpretation:

- the Electron browser/main process was spending time in filesystem event management
- this strongly suggested watcher churn or watcher overload

### Renderer sample

The renderer sample did **not** primarily point to obvious mouse/pointer handlers.

That mattered because the symptom had initially looked like a renderer interaction bug.

### GPU sample

The GPU sample did not point to a strong Metal/compositor failure as the main explanation.

That helped rule out a pure graphics-path explanation.

## Why The Sample Was So Valuable

At the JavaScript level, we did **not** yet have decisive evidence.

The sample let us move from a vague suspicion:

> "Something low-level is wrong"

to a concrete subsystem hypothesis:

> "The browser/main process is overloaded by filesystem watcher activity"

That was the bridge from runtime symptoms to the eventual code search in the watcher infrastructure.

## Capture Samples

Browser/main process:

```bash
sample <browser-pid> 5 -file /tmp/nearbytes-electron-browser.sample.txt
```

Renderer:

```bash
sample <renderer-pid> 5 -file /tmp/nearbytes-electron-renderer.sample.txt
```

GPU:

```bash
sample <gpu-pid> 5 -file /tmp/nearbytes-electron-gpu.sample.txt
```

## What To Search For

After sampling, inspect the text for patterns like:

- `NSEvent`
- `AppKit`
- `Metal`
- `uv_fs_event`
- `FSEventStream`
- `uv_sem_wait`
- `mach_msg`

## What Happened In The Case Study

The browser-process sample contained strong signs of filesystem watcher activity:

- `uv_fs_event_stop`
- `uv__fsevents_close`
- `FSEventStream...`
- `uv_sem_wait`

That was the turning point.

It suggested that the Electron browser process was overloaded by filesystem event machinery, not by normal UI rendering.

## Important Caution for Class

If students add heavy instrumentation before sampling, the sample may also contain profiler or inspector-related frames.

That happened briefly in this session too.

So remind students:

- `sample` shows what the process is doing, including your instrumentation overhead
- interpret patterns carefully
- look for repeated subsystem evidence across logs, metrics, and code, not just one isolated symbol

## Minimal Reproduction Script

If you want the shortest classroom version of this step:

1. Start the app.
2. Reproduce the freeze.
3. Find the Electron browser/main PID.
4. Run:

```bash
sample <browser-pid> 5 -file /tmp/electron-browser.sample.txt
rg "uv_fs_event|FSEventStream|uv_sem_wait|AppKit|Metal" /tmp/electron-browser.sample.txt
```

That is often enough to motivate the next debugging step.

## Teaching Point

This is the moment where debugging crosses layers:

- from renderer/UI
- to Electron internals
- to libuv
- to macOS FSEvents

That is exactly why this makes a good systems-debugging case study.

## Discussion Prompt

Ask students:

> What kinds of bugs become visible only when you drop below the application layer and inspect OS/runtime stacks?

## Takeaways

### Low-level / systems takeaway

Operating-system tools like `sample` expose subsystems that application logs hide: AppKit, Metal, libuv, semaphores, filesystem events, and IPC. Real software behavior is always partly shaped by these lower layers.

### Debugging takeaway

When logs stop explaining the problem, go down a layer. Native sampling is a classic example of changing the instrument when the current one is no longer informative.

### AI-tooling takeaway

AI works best here as an interpreter and guide: help identify which PID to sample, what subsystems to search for, and how to connect symbolic traces back to likely code areas. The tool does not replace the OS diagnostic; it helps make sense of it.

### Software development takeaway

Software development is not only about writing code. Serious debugging sometimes requires literacy in the operating system, runtime, and platform tooling that the application sits on top of.
