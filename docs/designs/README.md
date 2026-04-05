# Nearbytes Designs

The design tree holds active architecture and migration designs that are binding for implementation until superseded by a newer design or a stable spec.

Designs are expected to be:

- implementation-facing
- explicit about migration safety, release gates, and parity blockers
- strict about preserving shipped desktop behavior until a replacement path proves parity
- strict about preserving a single shared UI codebase across desktop and phone hosts
- strict about keeping shared-surface application crypto and semantics in browser-owned code
- explicit about transitional compatibility shims, including their limits and removal conditions

A design is incomplete if it relies on aspirational wording where an implementer needs a concrete rule, forbidden shortcut, or exit gate.

Current active design line for the shared web app plus Capacitor translation:

- `architecture/shared-host-hierarchy-v1.md`
- `architecture/host-contract-runtime-boundary-v1.md`
- `architecture/browser-application-crypto-boundary-v1.md`
- `architecture/portable-core-system-v1.md`
- `migration/desktop-safe-capacitor-translation-v1.md`
- `migration/phase-1-voyage-v1.md`
- `platform/README.md`
- `platform/phase-1-surface-inventory-v1.md`
- `platform/phase-1-capability-matrix-v1.md`

## Reading Order

1. `architecture/shared-host-hierarchy-v1.md`
2. `architecture/host-contract-runtime-boundary-v1.md`
3. `architecture/browser-application-crypto-boundary-v1.md`
4. `architecture/portable-core-system-v1.md`
5. `migration/desktop-safe-capacitor-translation-v1.md`
6. `migration/phase-1-voyage-v1.md`
7. `platform/README.md`
8. `platform/phase-1-surface-inventory-v1.md`
9. `platform/phase-1-capability-matrix-v1.md`

## Precedence

If two documents seem to overlap, apply them in this order:

1. architecture documents define shared ownership and boundaries;
2. migration documents define sequencing, temporary compatibility rules, and release gates;
3. platform documents define how each host satisfies the shared contract.

Platform documents may narrow a host-specific runtime plan, but they may not weaken the shared architecture rules or the migration parity gates.

## Families

- `architecture/`: target module, host, and runtime boundaries.
- `migration/`: stepwise translation plans with explicit desktop-preservation and phone-ship gates.
- `platform/`: host-specific design notes that explain how a host satisfies the shared contract without redefining shared feature ownership.

## Rule Of Thumb

If a document answers "what should we change next without breaking the current shipped app?", it belongs here.

If it answers "what is the stable product or protocol contract?", it belongs in `docs/specs/`.