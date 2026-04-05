# Nearbytes Designs

The design tree holds active architecture and migration designs that are not yet stable enough to become specs.

Designs are expected to be:

- implementation-facing
- easy to revise or supersede
- explicit about migration safety
- strict about preserving shipped desktop behavior until a replacement path proves parity
- strict about preserving a single shared UI codebase across desktop and mobile hosts

Current active design line for the shared web app plus Capacitor translation:

- `architecture/shared-host-hierarchy-v1.md`
- `architecture/browser-application-crypto-boundary-v1.md`
- `architecture/portable-core-system-v1.md`
- `migration/desktop-safe-capacitor-translation-v1.md`
- `migration/phase-1-voyage-v1.md`
- `platform/README.md`
- `platform/phase-1-capability-matrix-v1.md`

## Families

- `architecture/`: target module, host, and runtime boundaries.
- `migration/`: stepwise translation plans with explicit desktop-preservation gates.
- `platform/`: host-specific design notes for desktop, browser, Capacitor, and future runtimes.

## Rule of Thumb

If a document answers "what should we change next without breaking the current shipped app?", it belongs here.

If it answers "what is the stable product or protocol contract?", it belongs in `docs/specs/`.