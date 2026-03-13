# Step 6 Lab: Search the Codebase for Filesystem Watchers

## Goal

Translate the native sampling clue into a code-level suspect.

## What This Step Teaches

- Good debugging moves back and forth between runtime evidence and source code.
- Once a subsystem is implicated, search narrowly and intentionally.

## Starting Clue

The native sample suggested heavy FSEvents/libuv filesystem watcher activity.

So the next question became:

> Where in the codebase do we create filesystem watchers?

## Search Commands

Use ripgrep to search for likely watcher APIs:

```bash
rg "chokidar|fs\\.watch|watch\\(|FSEvents|watcher" src
```

## How We Used This Search

This search did not happen in a vacuum.

It was driven by specific runtime evidence:

- process metrics said the browser/main process was active
- native samples said FSEvents/libuv filesystem activity was present

So this was not a broad, random grep through the codebase.

It was a targeted architectural search:

> "Show me the code that talks to the subsystem named in the sample."

That is an important debugging pattern for students to learn.

## Files To Inspect

In this case, the search quickly pointed to:

- `src/server/sourceWatchHub.ts`
- `src/server/volumeWatchHub.ts`

## Why These Two Files Mattered

They both used `chokidar`, but they played different roles:

- `VolumeWatchHub` tracked filesystem changes for a specific active volume
- `SourceWatchHub` tracked broad source-discovery roots

That distinction was crucial because the freeze felt global and heavy, which made broad discovery watching more suspicious than per-volume watching.

## What To Compare

### `VolumeWatchHub`

This one watches paths tied to a specific volume and is comparatively narrow.

### `SourceWatchHub`

This one was more suspicious because it watches source-discovery roots for cloud providers.

## What To Read Carefully

When students inspect `SourceWatchHub`, ask them to identify:

1. where watcher targets are computed
2. whether those targets are narrow or broad
3. how deep the recursion goes
4. whether the watched paths could be huge on a real machine

In this case, the watched roots mapped to real cloud-storage folders, not just tiny test directories.

## The Key Suspicion

`SourceWatchHub` was using targets that looked like:

- `~/Library/CloudStorage/Dropbox`
- `~/Library/Mobile Documents/com~apple~CloudDocs`
- `~/MEGA`

That is a red flag on many machines because these are huge trees.

## Why This Was More Than a Theoretical Concern

On a machine with:

- large Dropbox contents
- large iCloud Drive contents
- synced MEGA folders

recursive watching of those roots can explode the number of required filesystem watches.

That fits perfectly with:

- `EMFILE`
- heavy FSEvents activity
- browser-process pressure

So by this point, the source code did not just look "a bit suspicious." It fit the runtime evidence.

## Classroom Exercise

Ask students to read `src/server/sourceWatchHub.ts` and answer:

1. What directories does it watch?
2. How deep does it watch?
3. Does it ignore initial events?
4. Would this scale on a machine with a very large Dropbox or iCloud directory?

## Suggested Follow-Up Question

After students answer those, ask:

> "If you had to preserve the feature but reduce watcher load, what narrower paths would you watch instead?"

That question prepares them for the final fix.

## Expected Insight

Students should realize that the code is not just "watching a project folder." It is potentially asking `chokidar` to recursively watch massive synced filesystems.

That connects the sample evidence to a plausible source-level root cause.

## Minimal Classroom Version

If you want to keep this step short:

1. show the native sample clue: `FSEventStream` / `uv_fs_event`
2. run:

```bash
rg "chokidar|watcher" src
```

3. open `src/server/sourceWatchHub.ts`
4. ask students to identify why watching `Dropbox`, `CloudDocs`, and `MEGA` recursively is risky

That is often enough to create the "aha" moment before the final proof step.

## Takeaways

### Low-level / systems takeaway

Filesystem watching is not abstract magic. Recursive watches over huge synced directory trees can stress OS file-descriptor limits, event subsystems, and runtime watcher implementations in very concrete ways.

### Debugging takeaway

Good bug hunting moves between runtime evidence and source code. Once a subsystem is implicated, search narrowly for the code that touches that subsystem rather than exploring the whole codebase blindly.

### AI-tooling takeaway

AI is particularly strong at turning a vague codebase into a map once you give it a precise question, such as "Where do we create filesystem watchers?" The key is to ask grounded, subsystem-specific questions.

### Software development takeaway

Architectural choices that seem harmless at the code level can have large operational consequences. A watcher on a small test directory and a watcher on all of Dropbox may look similar in code, but they are radically different in production behavior.

## Discussion Prompt

Ask students:

> Why is "search for the subsystem named in the native trace" such an effective debugging strategy?
