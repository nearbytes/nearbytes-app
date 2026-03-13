# Electron Freeze Case Study

(written by GPT-5.4 as prompted by Alexander and Vincenzo)

**Start here.** This folder contains teaching materials for a single debugging story: the Nearbytes desktop app (Electron) freezing on mouse interaction, and how the cause was found and fixed.

## Where to begin

1. **[Case Study: Hunting an Electron Freeze](./electron-freeze-case-study.md)** — Main narrative: symptom, investigation, root cause (filesystem watchers on cloud roots → EMFILE), and fix. Links to all step handouts and supporting docs.
2. **[Lesson Plan](./electron-freeze-lesson-plan.md)** — For instructors: pacing, talking points, and how to run the labs in class (no pre-class reading).

## Narrative option

- **[A Short Story: The Electron Freeze](./electron-freeze-story.md)** — Same bug as a short story (Gabe, Vincenzo, Alexander).
- **[Screenplay version](./electron-freeze-story-screenplay.md)** — Scene-based version of the story.

## Step-by-step labs (handouts)

| Step | Topic |
|------|--------|
| 1 | [Make Startup Deterministic](./electron-freeze-step-1-startup-deterministic.md) |
| 2 | [Instrument Electron Window Lifecycle](./electron-freeze-step-2-window-lifecycle.md) |
| 3 | [Redirect Renderer Console and Add Diagnostics](./electron-freeze-step-3-renderer-console-and-diagnostics.md) |
| 4 | [Measure Which Electron Process Is Busy](./electron-freeze-step-4-process-metrics.md) |
| 5 | [Capture Native macOS Stack Samples](./electron-freeze-step-5-native-sampling.md) |
| 6 | [Search the Codebase for Filesystem Watchers](./electron-freeze-step-6-codebase-search-watchers.md) |
| 7 | [Add Watcher Logs, Confirm the Cause, and Apply the Fix](./electron-freeze-step-7-watch-lifecycle-and-fix.md) |

## Supporting notes

- [Session Timeline](./electron-freeze-session-timeline.md)
- [Restarts and Runs](./electron-freeze-restarts-and-runs.md)
- [Edit Sequence](./electron-freeze-edit-sequence.md)
- [Conversation Reconstruction](./electron-freeze-conversation-reconstruction.md)

## Lab starting point

To reproduce from the same repo state, use commit:  
[`07aa249b306c436a3973add886f9a914782770bc`](https://github.com/nearbytes/nearbytes-app/commit/07aa249b306c436a3973add886f9a914782770bc).
