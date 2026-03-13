# A Short Story: The Electron Freeze

It started like the kind of bug that makes everyone slightly overconfident.

The browser version of the app worked. The Electron app did not. The icon appeared in the dock, the local web server was clearly running, and yet the desktop app would beachball, freeze, or act as if it had slipped into some half-real half-broken state. On the surface, it looked like a frontend bug. A mouse bug, maybe. A window bug. Something in the renderer. Something visual.

Alexander watched the app and described what seemed obvious: the problem showed up when interacting with the Electron window. That made the first theory almost irresistible. Somewhere in the UI, something had to be choking.

So the debugging began where most people would begin. Renderer logs. Window lifecycle hooks. Console forwarding. Diagnostics for slow pointer handlers, long tasks, unhandled promise rejections. It was all very systematic. The AI added the instrumentation, relaunched the app, and the terminal started speaking back.

And then something unusual happened.

The evidence refused to tell the expected story.

The renderer loaded. Vite connected. The window reached `ready-to-show`. `did-finish-load` fired. The console logs came through. The diagnostics harness installed. But when the freeze happened, the renderer stayed strangely quiet. No dramatic exception. No obvious long task. No smoking gun in the UI layer.

That was the first real turn in the investigation.

The bug had not disappeared. It had become more interesting.

So the AI went lower.

Process metrics came next. Electron was split into its usual cast of characters: `Browser`, `Tab`, `GPU`, `Utility`. If the UI was freezing, surely the `Tab` renderer would be the one screaming. But it was not. The renderer stayed mostly calm. The `Browser` process was the one doing the work.

That changed the mood in the room.

At this point, Vincenzo and Alexander were no longer watching a normal debugging session. They were watching the investigation move across layers in real time, from the visible window to the hidden structure underneath it.

Then came Step 5.

The app was frozen live. Instead of staring at the code and guessing harder, the AI captured native macOS samples from the running Electron processes: browser, renderer, GPU. The output was dense, technical, not the sort of thing most people casually read during application debugging. But inside the noise there was a pattern: `uv_fs_event_stop`, `uv__fsevents_close`, `FSEventStream`, `uv_sem_wait`.

Now the suspicion had a shape.

This was no longer a mouse bug. No longer even mainly a renderer bug. Something down in the filesystem-watching machinery was thrashing the Electron browser process.

From there, the search became sharper. `chokidar`. `SourceWatchHub`. `VolumeWatchHub`. The code was no longer an ocean; it had become a map with a marked region.

Then came the decisive moment: watcher lifecycle logs.

The terminal printed the line that made the whole session snap into focus:

```text
[source-watch] created watcher #1; targets=["/Users/akurz/Library/CloudStorage/Dropbox","/Users/akurz/Library/Mobile Documents/com~apple~CloudDocs","/Users/akurz/MEGA"] depth=3
[source-watch] watcher #1 error: EMFILE: too many open files, watch
```

Not once, but over and over.

That was it.

The Electron app had not been freezing because of some delicate UI interaction. It had been drowning under recursive filesystem watches on enormous cloud-storage roots. The beachball was real, but the cause was lower, heavier, more infrastructural than it first appeared.

The fix, when it came, was almost modest. Do not watch all of Dropbox, all of iCloud Drive, and all of MEGA. Watch the Nearbytes directories that actually matter:

- `Dropbox/nearbytes`
- `CloudDocs/nearbytes`
- `MEGA/nearbytes`

Run again.

No flood of `EMFILE`.
No runaway source watcher.
Browser CPU drops back down.
The system becomes quiet.

And that was part of what made the whole thing memorable: the ending was not flashy. It was precise. A good fix often is.

Afterward, Alexander reflected on how exciting it had felt to watch the debugging unfold. Vincenzo agreed. At one point, watching the AI move from renderer logs to native stack sampling to watcher forensics, a friend said:

> "I have never seen anything like this."

That reaction mattered. Not because the AI had performed magic, but because the session made visible something that is usually hidden inside expert intuition: the real shape of debugging.

Not guessing.
Not random tinkering.
Not just staring at code until inspiration arrives.

But a sequence:

- stabilize the run
- instrument the right boundary
- notice when the expected evidence does not appear
- shift layers
- sample the live system
- search the codebase with a better question
- prove the cause
- apply the smallest fix that explains everything

For students, that is the real story.

The bug was interesting. But the method was the lesson.
