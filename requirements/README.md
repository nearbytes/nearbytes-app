# Nearbytes Requirements Library

This directory contains normative requirements for the Nearbytes product and codebase.

The requirements set is intentionally modular:

- each document covers one coherent concern area
- requirement identifiers are stable within that area
- specifications in `docs/specs/` realize or refine these requirements
- engineering practices and review gates live separately from product/system capability requirements

## Document Roles

### [requirements/se-practices.md](/Users/vincenzo/data/local/repos/nearbytes-app/requirements/se-practices.md)

Purpose:

- codebase-wide engineering constraints
- review checklist items
- non-negotiable implementation and UI hygiene rules

Use this document when asking:

- what practices are always required for contributors?
- what must reviewers check before accepting a change?

### [requirements/shared-ui-and-hosts.md](/Users/vincenzo/data/local/repos/nearbytes-app/requirements/shared-ui-and-hosts.md)

Purpose:

- shared UI behavior across desktop, web, and phone hosts
- host/runtime ownership boundaries
- iPhone-sized usability expectations for shared surfaces

Use this document when asking:

- what must remain true across host implementations?
- what are the runtime ownership constraints for the shared UI?

### [requirements/reactive-provider-ui.md](/Users/vincenzo/data/local/repos/nearbytes-app/requirements/reactive-provider-ui.md)

Purpose:

- provider-originated hub reactivity
- runtime-to-UI semantic push delivery
- recovery expectations for missed events and reconnects

Use this document when asking:

- how must filesystem, LAN, and MEGA updates reach the UI?
- what is the normative reactive design for provider-backed hub state?

## Requirement Writing Rules

The requirements library follows these rules:

1. each requirement states one obligation
2. each requirement has a stable identifier
3. each capability requirement includes acceptance criteria where practical
4. rationale is included when architectural intent would otherwise be easy to regress
5. implementation notes may exist, but requirements must remain solution-independent where possible
6. traceability to realizing specs should be explicit when a wire protocol or storage contract exists

## Relationship To Specs

Requirements answer:

- what the system must do
- what constraints must remain true
- what behaviors are non-negotiable

Specifications in [docs/specs/README.md](/Users/vincenzo/data/local/repos/nearbytes-app/docs/specs/README.md) answer:

- how a protocol, payload, or subsystem is shaped
- how versioned contracts are encoded
- how components interoperate at the technical design level

## Review Guidance

When adding new requirements:

1. place them in the narrowest document that matches the concern area
2. avoid mixing evergreen engineering rules with feature-specific system requirements
3. prefer a new focused document over growing one file into a grab bag
4. cross-link related documents instead of duplicating the same requirement text in multiple places