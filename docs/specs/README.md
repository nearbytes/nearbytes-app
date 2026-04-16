# Nearbytes Specs

The spec tree is organized by concern, not by chronology.

Current active design line for the unreleased opaque-event refactor:

- `application/hub-model-v0.2.md`
- `application/file-events-v0.3.md`
- `application/file-commands-v0.2.md`
- `application/app-records-v0.2.md`
- `application/chat-events-v0.2.md`
- `application/hash-cursor-refresh-v0.1.md`
- `identity/identity-management-v0.2.md`
- `identity/identity-channel-v0.2.md`
- `storage/data-correctness-v0.2.md`
- `storage/meta-storage-v0.3.md`
- `transport/storage-commands-v0.1.md`
- `transport/lan-sync-v0.4.md`

Supporting runtime and provider-port specifications:

- `storage/shared-path-storage-v0.1.md`
- `transport/mega-runtime-v0.1.md`
- `transport/phone-mega-port-plan-v0.1.md`
- `transport/shared-runtime-services-v0.1.md`

Earlier pre-opaque docs remain in-tree only as historical snapshots unless they are explicitly referenced by the active design line.

LAN note:

- `transport/lan-sync-v0.4.md` defines DNS-SD over mDNS as the normative primary discovery mechanism.
- The current implementation also permits compact UDP multicast fallback discovery as a resilience layer on local networks where DNS-SD visibility is unreliable.

## Families

- `registry/`: naming, versioning, and shared registry rules.
- `application/`: user-facing hub semantics, files, chat, and product vocabulary.
- `identity/`: identity publication, snapshots, and management flows.
- `references/`: `nb.*` reference payloads and content descriptors.
- `storage/`: on-disk layout, correctness, reconciliation, and storage integration rules.
- `transport/`: join links, transport endpoints, transport recipes, log/transport mappings, and LAN sync.

Directory hygiene rule:

1. keep new specification filenames concise and family-scoped;
2. prefer one concern per file over omnibus migration notes;
3. when a migration plan is needed, keep it additive and place it beside the affected family specs.

## Rule of Thumb

If a spec answers "what does the app mean?", it belongs in `application/`.

If it answers "who is speaking?", it belongs in `identity/`.

If it answers "what object is this?", it belongs in `references/`.

If it answers "where do bytes live and how are roots reconciled?", it belongs in `storage/`.

If it answers "how does a peer or route carry Nearbytes data?", it belongs in `transport/`.
