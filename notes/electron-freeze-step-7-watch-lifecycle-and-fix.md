# Step 7 Lab: Add Watcher Logs, Confirm the Cause, and Apply the Fix

## Goal

Produce decisive proof that filesystem watcher overload is causing the freeze, then apply the smallest correct fix.

## What This Step Teaches

- Once you have a suspect, instrument the boundary directly.
- Good debugging ends with a fix that explains the evidence.

## Hypothesis Under Test

The app freezes because `SourceWatchHub` is recursively watching massive cloud-storage roots and hitting watcher/resource limits.

## Instrumentation To Add

Add logs for:

- when the source watch opens in the client
- when a watcher is created in the server
- watcher target directories
- watcher readiness
- watcher close requests
- watcher close duration
- watcher errors

## How We Used This In Practice

This step was the moment where suspicion had to become proof.

By this point we already had:

- quiet renderer diagnostics
- browser-process activity from `app.getAppMetrics()`
- native samples implicating FSEvents/libuv
- a code search pointing to `SourceWatchHub`

What we still needed was a direct, human-readable statement from the app itself:

> "Here is the watcher I created, here are the paths it is watching, and here is the exact error it is throwing."

## Useful Logs

Client side:

- `[watch-sources:<id>] opening`
- `[watch-sources:<id>] opened`
- `[watch-sources:<id>] close requested`

Server side:

- `[source-watch] created watcher #...`
- `[source-watch] watcher #... ready`
- `[source-watch] watcher #... error: ...`
- `[source-watch] closing watcher #...`

## Where To Add The Logs

### Client side

In `ui/src/lib/api.ts`, log:

- when `watchSources()` opens
- when it succeeds
- when it aborts
- when `close()` is requested

This lets students correlate renderer-side watch setup with server-side watcher creation.

### Server side

In `src/server/sourceWatchHub.ts`, log:

- watcher creation
- the target directories
- watcher readiness
- watcher reuse
- watcher close timing
- watcher errors

This is the most important boundary in the whole investigation.

## Reproduction Run

```bash
yarn dev-run --kill
```

Then:

1. let the desktop app reach its normal startup state
2. do the interaction that usually causes the freeze
3. keep the terminal visible
4. watch for source-watch logs

## What We Actually Saw

The decisive lines were:

```text
[source-watch] created watcher #1; targets=["/Users/akurz/Library/CloudStorage/Dropbox","/Users/akurz/Library/Mobile Documents/com~apple~CloudDocs","/Users/akurz/MEGA"] depth=3
[source-watch] watcher #1 error: EMFILE: too many open files, watch
```

repeated over and over.

This mattered because those lines linked three previously separate clues:

1. huge cloud roots
2. filesystem watcher overload
3. the exact operating-system-level failure (`EMFILE`)

## Decisive Evidence

In the case study, the terminal showed:

```text
[source-watch] created watcher #1; targets=["/Users/akurz/Library/CloudStorage/Dropbox","/Users/akurz/Library/Mobile Documents/com~apple~CloudDocs","/Users/akurz/MEGA"] depth=3
[source-watch] watcher #1 error: EMFILE: too many open files, watch
```

repeated many times.

That is the smoking gun.

## Interpretation

At this point the chain of reasoning is:

1. the renderer is not obviously freezing in JavaScript
2. the browser/main process is the busy one
3. native stacks show FSEvents/libuv watcher work
4. watcher logs show recursive watches on huge roots
5. the system reports `EMFILE`

All of the evidence points to the same explanation.

## Why This Was the Decisive Step

Earlier steps narrowed the search space.

This step produced the first log that directly named:

- the subsystem
- the watched paths
- the error condition

That is what transforms a good theory into a defensible diagnosis.

## The Fix

Do **not** recursively watch entire Dropbox/iCloud/MEGA roots.

Instead, watch only narrow Nearbytes candidate directories such as:

- `.../Dropbox/nearbytes`
- `.../CloudDocs/nearbytes`
- `.../MEGA/nearbytes`

In this case, the source watch plan was changed to use discovered/suggested Nearbytes directories instead of raw provider roots.

## How We Chose the Fix

The correct fix was not:

- hide the error
- retry harder
- increase noise limits
- blame the renderer

The correct fix was to reduce the watch scope to match the real semantics of the feature.

Nearbytes did not need to recursively watch all of Dropbox or all of iCloud Drive. It only needed to watch the Nearbytes candidate directories.

So the watch targets were narrowed to directories like:

- `.../Dropbox/nearbytes`
- `.../CloudDocs/nearbytes`
- `.../MEGA/nearbytes`

## How To Verify the Fix

After applying the fix, run:

```bash
yarn dev-run --kill
```

Expected behavior:

- source watch starts without `EMFILE`
- watcher targets are narrow `nearbytes` directories
- browser CPU falls back toward idle after initial reconcile
- the app no longer beachballs in the same way

## What Verification Looked Like

After the fix, the watcher log changed from broad roots to narrow targets:

```text
[source-watch] created watcher #1; targets=["/Users/akurz/Library/CloudStorage/Dropbox/nearbytes","/Users/akurz/Library/Mobile Documents/com~apple~CloudDocs/nearbytes","/Users/akurz/MEGA/nearbytes"] depth=3
[source-watch] watcher #1 ready
```

At the same time:

- the `EMFILE` flood disappeared
- browser CPU dropped toward idle after initial reconcile

That is an excellent example of a fix whose success is visible in both logs and runtime behavior.

## Example Healthy Output

```text
[source-watch] created watcher #1; targets=[".../Dropbox/nearbytes",".../CloudDocs/nearbytes",".../MEGA/nearbytes"] depth=3
[source-watch] watcher #1 ready
```

with no repeated `EMFILE` messages.

## Minimal Classroom Version

For a compact classroom demo:

1. add source-watch lifecycle logs
2. run the app
3. show the repeated `EMFILE` error
4. narrow the watch targets
5. rerun
6. show the absence of `EMFILE` and the narrower targets

That creates a very satisfying before/after comparison for students.

## Classroom Wrap-Up

Ask students:

> Why is narrowing the watch scope a better fix than simply suppressing the `EMFILE` errors?

Good answer:

- it removes the source of overload
- it preserves intended behavior
- it matches the actual semantics of what Nearbytes needs to watch

## Final Teaching Point

This is what a strong debugging finish looks like:

- the fix is small
- the fix is local
- the fix explains the evidence
- the fix changes the runtime metrics in the expected direction

## Takeaways

### Low-level / systems takeaway

Resource exhaustion bugs often come from asking the operating system to do too much of the wrong kind of work. Here, recursive filesystem watching over huge cloud roots triggered `EMFILE` and FSEvents pressure in the Electron browser process.

### Debugging takeaway

The strongest diagnoses unify multiple kinds of evidence. This step worked because logs, metrics, native sampling, and source-code structure all converged on the same explanation.

### AI-tooling takeaway

AI is most useful at the end of an investigation when it can help turn a strong suspicion into a clean instrumented proof and then into a small, principled fix. The model is most effective when asked to help test a precise hypothesis.

### Software development takeaway

A good fix is not just "the app stopped crashing." A good fix preserves the feature, reduces system stress, and makes the software's behavior line up better with its intended semantics. Narrowing the watch scope did exactly that.
