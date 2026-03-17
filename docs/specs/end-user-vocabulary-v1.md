# End-User Vocabulary v1

## Goal
This document defines the words Nearbytes should use in end-user-facing UI copy.

The intent is to keep the product language clear and stable:
- one word for the logical thing a person opens and collaborates in
- one word for the physical places where data is stored
- one word for the rules that decide where encrypted data is kept

Internal terms such as `volume`, `source`, `destination`, and `root` may remain in code and protocol docs, but they should not be the default terms in the product UI.

## Primary terms

### Hub
`Hub` is the primary user-facing word for the logical Nearbytes unit that is opened from a secret.

A hub can contain:
- files
- chat
- history
- identities

Use `hub` in UI for:
- opening
- switching
- joining chat
- showing IDs
- default rules

Examples:
- `Open hub`
- `Switching hub`
- `Hub ID`
- `This hub will chat as Ada`

### Storage location
`Storage location` is the primary user-facing word for a physical place where Nearbytes can read or write encrypted data.

A storage location is typically:
- a local folder
- a Dropbox folder
- an Apple/iCloud folder
- a Google Drive folder
- a OneDrive folder
- a MEGA folder

Use `location` or `storage location` in UI for:
- discovery
- configuration
- diagnostics
- lists of saved folders
- capacity readouts about available storage

Examples:
- `Storage locations`
- `New Nearbytes storage locations detected`
- `Saved locations`
- `Available storage`
- `This location keeps a protected copy`

### Folder
Use `folder` when the UI is asking the user to choose or inspect a filesystem path.

Examples:
- `Add folder`
- `Choose folder`
- `Open folder`

### Provider
`Provider` is the user-facing word for an external service or route family Nearbytes can use to satisfy a storage or join recipe.

Use `provider` in UI for:

- provider cards
- provider badges
- connected account status
- storage location selection
- route choice when several transports are possible

Use provider names as labels for both:

- the service hosting a storage location
- the service behind a provider-backed location or suggested route

Examples:
- `Dropbox`
- `Apple/iCloud`
- `Google Drive`
- `Choose a provider`
- `Connected providers`
- `This join link recommends Google Drive first`

### Keep rule / sync rule
Use `keep rule` or `sync rule` for user-facing policy about where a hub stores encrypted history and blocks.

Use:
- `keep rule` when the UI is specifically about retaining full copies
- `sync rule` when the UI is about enabling a location for a known hub

Examples:
- `Edit rules`
- `Forget saved keep rule`
- `Sync enabled for 2 known hubs`

## Terms to avoid in main UI

### Volume
Avoid in end-user UI.

Reason:
- too technical
- sounds like a disk partition
- does not clearly include chat/history/collaboration

Allowed:
- internal code
- internal protocol docs
- migration/debug text if necessary

### Source / destination / root
Avoid in primary UI.

Reason:
- implementation-oriented
- describes configuration internals, not user concepts

Preferred replacements:
- `source` -> `storage location`
- `destination` -> `location` or `keep rule`
- `root` -> `folder` or `storage location`

### Share
Do not use as the main Nearbytes noun.

Reason:
- a cloud share is a transport or permission concept
- a Nearbytes hub can span multiple locations
- a location may exist without being the logical thing people collaborate in

Use only when talking about the cloud provider’s own sharing feature.

### Project
Do not use as the default Nearbytes noun.

Reason:
- too narrow
- Nearbytes hubs may be personal, social, archival, or experimental

## Copy rules

### Prefer plain language
Prefer:
- `hub`
- `storage location`
- `folder`
- `rules`

Avoid:
- `volume`
- `source`
- `destination`
- `root`

### Be concrete about physical vs logical
Use `hub` for the logical unit.
Use `storage location` for the physical folder/provider.

Bad:
- `This share stores your source`

Good:
- `This storage location keeps a protected copy of this hub`
- `Choose a provider, then use that storage location in this hub`

### Use folder when asking for a path
If the action opens a picker or file manager, say `folder`, not `location`.

Good:
- `Choose folder`
- `Open folder`

## Mapping table

| Internal term | End-user term |
| --- | --- |
| volume | hub |
| source | storage location |
| destination | keep rule / sync rule / location |
| root | folder / storage location |
| defaultVolume | defaults for newly opened hubs |

## Example UI phrases
- `Storage locations`
- `Saved locations`
- `Available storage`
- `New Nearbytes storage locations detected in Dropbox and Apple/iCloud.`
- `We added 3 locations and enabled sync for 2 known hubs.`
- `Open this hub first, then choose which locations keep a full copy.`
- `This location is not keeping this hub yet.`
