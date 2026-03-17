## Dropbox `files/list_folder/longpoll` API

This API lets a client wait for changes in a Dropbox folder tree without constant polling. It does not return changed files directly. Instead, the client first gets a cursor from `/files/list_folder`, then calls `/files/list_folder/longpoll` with that cursor. The long-poll request blocks until Dropbox detects a change or the timeout expires. When it returns `changes: true`, the client must call `/files/list_folder/continue` to fetch the actual delta. This is Dropbox’s recommended pattern for client-side near-real-time change detection; for server-side background notifications, Dropbox recommends webhooks instead.

Official docs:
- Detecting Changes Guide: https://developers.dropbox.com/detecting-changes-guide
- `/files/list_folder`: https://www.dropbox.com/developers/documentation/http/documentation#files-list_folder
- `/files/list_folder/longpoll`: https://www.dropbox.com/developers/documentation/http/documentation#files-list_folder-longpoll
- `/files/list_folder/continue`: https://www.dropbox.com/developers/documentation/http/documentation#files-list_folder-continue
- Webhooks: https://www.dropbox.com/developers/reference/webhooks

### Operational model
1. Call `/files/list_folder` on a path, usually with `recursive=true`, and save the returned cursor.
2. Call `/files/list_folder/longpoll` with that cursor.
3. If the response says changes exist, call `/files/list_folder/continue`.
4. Process entries and store the new cursor for the next cycle.

### What it is good for
- Efficient file/folder sync indicators in desktop, mobile, or browser clients
- Detecting Dropbox changes with near-real-time behavior
- Reducing wasteful short-interval polling

### What it is not
- Not a WebSocket or event stream
- Not guaranteed hard real-time
- Not a source of file content by itself
- Not the preferred inbound notification method for backend apps; use webhooks there

### Best fit
Use it as a change trigger: wait for Dropbox updates, then pull deltas, then refresh local state. Do not treat it as a messaging bus or collaboration event layer. 