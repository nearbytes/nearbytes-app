# Nearbytes Specs

The spec tree is organized by concern, not by chronology.

## Families

- `registry/`: naming, versioning, and shared registry rules.
- `application/`: user-facing hub semantics, files, chat, and product vocabulary.
- `identity/`: identity publication, snapshots, and management flows.
- `references/`: `nb.*` reference payloads and content descriptors.
- `storage/`: on-disk layout, correctness, reconciliation, and storage integration rules.
- `transport/`: join links, transport endpoints, transport recipes, and log/transport mappings.

## Rule of Thumb

If a spec answers "what does the app mean?", it belongs in `application/`.

If it answers "who is speaking?", it belongs in `identity/`.

If it answers "what object is this?", it belongs in `references/`.

If it answers "where do bytes live and how are roots reconciled?", it belongs in `storage/`.

If it answers "how does a peer or route carry Nearbytes data?", it belongs in `transport/`.
