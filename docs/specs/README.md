# Nearbytes Specs

The spec tree is organized by concern, not by chronology.

Current active design line for the unreleased opaque-event refactor:

- `application/hub-model-v0.2.md`
- `application/file-events-v0.3.md`
- `application/file-commands-v0.2.md`
- `application/app-records-v0.2.md`
- `application/chat-events-v0.2.md`
- `identity/identity-management-v0.2.md`
- `identity/identity-channel-v0.2.md`
- `storage/data-correctness-v0.2.md`
- `storage/meta-storage-v0.3.md`
- `transport/lan-sync-v0.3.md`

Earlier pre-opaque docs remain in-tree only as historical snapshots unless they are explicitly referenced by the active design line.

LAN note:

- `transport/lan-sync-v0.3.md` defines DNS-SD over mDNS as the normative primary discovery mechanism.
- The current implementation also permits compact UDP multicast fallback discovery as a resilience layer on local networks where DNS-SD visibility is unreliable.

## Families

- `registry/`: naming, versioning, and shared registry rules.
- `application/`: user-facing hub semantics, files, chat, and product vocabulary.
- `identity/`: identity publication, snapshots, and management flows.
- `references/`: `nb.*` reference payloads and content descriptors.
- `storage/`: on-disk layout, correctness, reconciliation, and storage integration rules.
- `transport/`: join links, transport endpoints, transport recipes, and log/transport mappings.
- `transport/`: join links, transport endpoints, transport recipes, log/transport mappings, and LAN sync.

## Rule of Thumb

If a spec answers "what does the app mean?", it belongs in `application/`.

If it answers "who is speaking?", it belongs in `identity/`.

If it answers "what object is this?", it belongs in `references/`.

If it answers "where do bytes live and how are roots reconciled?", it belongs in `storage/`.

If it answers "how does a peer or route carry Nearbytes data?", it belongs in `transport/`.
