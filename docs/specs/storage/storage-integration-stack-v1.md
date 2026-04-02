# Nearbytes Storage Integration Stack v1

Status: draft normative specification.

This document defines the operational layering for Nearbytes storage integrations.

Its purpose is to make boundary ownership explicit so provider adapters stay narrow, storage reconciliation remains centralized, and application features do not leak into provider-specific code.

## 1. Scope

This specification defines four layers:

1. storage location
2. storage provider
3. storage reconciliation
4. application layer

It covers local roots, provider-managed roots, managed-share refresh, and the ownership boundaries between these layers.

It does not define:

1. cryptographic payload formats
2. chat/file application semantics
3. provider authentication protocols themselves

## 2. Stack

Nearbytes storage integration MUST be understood as this ordered stack:

1. **Storage Location**
2. **Storage Provider**
3. **Storage Reconciliation**
4. **Application Layer**

The direction of authority is bottom-up for raw bytes and top-down for policy.

Interpretation:

1. storage locations expose concrete `blocks/` and `channels/` trees
2. storage providers refresh or publish those trees for one external system
3. storage reconciliation decides how multiple locations participate in one Nearbytes storage graph
4. the application layer decides user-visible workflows, joins, shares, and feature semantics

## 3. Storage Location Layer

The storage location layer is the filesystem-shaped root described by Nearbytes meta-storage.

Examples:

1. a local disk root configured directly by the user
2. a provider-managed mirror root under the Nearbytes managed-share area
3. a removable or discovered root normalized into the Nearbytes on-disk layout

Normative rules:

1. A storage location MUST be represented only by its local Nearbytes-compatible directory.
2. A storage location MUST NOT contain provider-specific reconciliation policy.
3. A storage location MAY be writable or readonly.
4. A storage location MAY be managed by a provider, but it is still just a root once materialized locally.

## 4. Storage Provider Layer

The storage provider layer is responsible for one external system such as Google Drive, GitHub, or MEGA.

Its job is to keep a provider-managed storage location refreshed or published.

Normative rules:

1. A provider adapter MUST translate provider-native state into a local Nearbytes storage location.
2. A provider adapter MUST limit itself to provider-scoped concerns:
   - authentication
   - provider inventory
   - provider-native polling, cursors, or callbacks
   - transferring provider-backed files into or out of one storage location
3. A provider adapter MUST NOT decide cross-root reconciliation policy.
4. A provider adapter MUST NOT redefine volume durability rules.
5. A provider adapter MUST NOT implement application-level conflict resolution.
6. For readonly provider shares, the provider adapter MUST treat the remote provider state as authoritative for that storage location.
7. For writable provider shares, the provider adapter MAY run a bidirectional mirror, but only for that share's storage location.

Clarification:

1. Refreshing a provider-managed local root is part of the provider layer.
2. Deciding how that root participates with other roots is not.

## 5. Storage Reconciliation Layer

The storage reconciliation layer is the Nearbytes layer that reasons across multiple storage locations.

In the current implementation this is primarily expressed by:

1. managed-share orchestration and attachment lifecycle
2. roots configuration and provider-managed source registration
3. multi-root storage routing and durable placement policy

Normative rules:

1. Storage reconciliation MUST own which sources exist in the active Nearbytes configuration.
2. Storage reconciliation MUST own which volumes attach to which sources.
3. Storage reconciliation MUST own merge, durable placement, and retention policy across roots.
4. Storage reconciliation MUST treat provider-managed roots as ordinary Nearbytes roots once attached.
5. Storage reconciliation MUST NOT depend on provider-specific internal node models.

## 6. Application Layer

The application layer defines user-facing features and workflows.

Examples:

1. join links
2. share creation and invitation UX
3. file and chat semantics
4. onboarding and account connection flows

Normative rules:

1. The application layer MAY request that a provider-managed share be created or attached.
2. The application layer MUST NOT assume provider-native tree structure beyond the adapter contract.
3. The application layer consumes managed-share summaries and transport state; it does not own raw provider sync behavior.

## 7. Provider-Managed Share Flow

The provider-managed share flow MUST be split as follows:

1. The application requests a managed share action.
2. The storage reconciliation layer creates or attaches a provider-managed source.
3. The provider layer refreshes the corresponding local storage location.
4. The storage reconciliation layer includes that location in the multi-root graph.
5. Application features then operate against the resulting Nearbytes storage graph.

This means provider refresh happens before and below multi-root reconciliation, not instead of it.

## 8. MEGA Requirements

MEGA integrations MUST follow the same stack discipline.

Normative rules:

1. MEGA MUST behave as a storage provider layer.
2. For readonly incoming shares and public links, MEGA MUST efficiently refresh the local managed-share root that corresponds to that MEGA resource.
3. MEGA MAY use MEGA-native incremental mechanisms such as cursors or action packets to decide when a refresh is needed.
4. MEGA MUST NOT embed cross-root reconciliation policy inside the MEGA adapter.
5. MEGA MUST NOT treat its managed-share root as application state; it is a provider-managed storage location.
6. Once the MEGA-managed root is refreshed locally, the rest of Nearbytes MUST treat it as an ordinary source.

## 9. Current Code Mapping

The current codebase maps to this stack approximately as follows:

1. Storage Location:
   - local source paths from roots config
   - provider-managed local mirror paths
2. Storage Provider:
   - provider adapters in `src/integrations/*`
   - provider-specific refresh/mirror workers used by those adapters
3. Storage Reconciliation:
   - `ManagedShareService`
   - roots config mutation and provider-managed source attachment
   - `MultiRootStorageBackend`
4. Application Layer:
   - server routes, join-link flows, file/chat services, UI workflows

## 10. Design Rule

When in doubt, use this test:

`Does this code decide how one provider-backed local root is refreshed, or does it decide how Nearbytes behaves across roots and features?`

If it refreshes one provider-backed root, it belongs in the provider layer.

If it decides behavior across roots, volumes, links, or application semantics, it belongs above the provider layer.