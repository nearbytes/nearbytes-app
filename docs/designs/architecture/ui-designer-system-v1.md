# UI Designer System v1

## Objective

Define a new shared Svelte application that serves as:

- the executable internal design system for Nearbytes;
- the source of truth for shared palette, typography, component, and surface exports;
- the UI-only replacement path for the current app shell;
- the future integration target that the runtime-backed app will consume by wiring logic into optional props rather than owning its own surfaces.

This design is implementation-facing and binding for the first production-ready UI effort.

## Non-Negotiable Constraints

- The designer app is a new Svelte app, separate from the current `ui/` workspace.
- The designer app contains no backend logic, sync logic, host-runtime logic, or fetch-layer ownership.
- The only logic owned by the designer app is UI state, UI transitions, responsive layout behavior, and mock-data presentation needed to render components and surfaces.
- The current app remains shippable while the new designer app is introduced.
- The designer app must export reusable artifacts that the real app can later consume as-is.
- Desktop and phone surfaces in the designer app must come from the same shared source files, with responsive differences only.
- Structural UI state is the only source of truth for the live state graph. Arbitrary form text, search text, filenames, loaded payload contents, and scroll positions are excluded from graph node identity.

## Product Thesis

The Nearbytes UI should become a pure executable mockup that already contains:

1. the visual system;
2. the component library;
3. the surface library;
4. the centralized typed UI state model;
5. the finite transition model between structural UI states.

The runtime-backed application should later become a thin wiring layer that imports these artifacts, injects real data and side effects, and stops owning its own surface implementations.

## New Workspace

The new workspace is `ui-designer/`.

It is additive in the first implementation phase:

- `ui/` remains the current runtime-backed app;
- `ui-designer/` becomes the executable design-system app and reusable export source;
- later work will make `ui/` consume exports from `ui-designer/` or from a package extracted from it.

## Required Designer Tabs

The designer app shell must expose these tabs:

1. `Moodboards`
2. `Typography`
3. `Palette`
4. `Components`
5. `State Graph`
6. `Desktop UI`
7. `Phone UI`

### Moodboards Tab

The moodboard tab is the creative root of the system.

It must ship with five curated moodboards informed by:

- the current Nearbytes branding and theme presets;
- the protocol and storage product character;
- the shared desktop and phone shell requirements;
- whitepaper and slide material when available in-repo or in the org.

The initial five moodboards are:

1. `Warm Ledger`: warm mineral paper, graphite ink, copper accents, documentary trust.
2. `Signal Harbor`: deep maritime blue, sea-glass green, crisp network topology energy.
3. `Quiet Workshop`: pale stone, smoked umber, tactile maker-tool atmosphere.
4. `Polar Archive`: cold white, steel blue, high-legibility archival minimalism.
5. `Night Relay`: dark carbon, electric cyan, restrained low-light operations console.

Each moodboard must define:

- palette tokens;
- typography tokens;
- sample component styling;
- desktop shell preview styling;
- phone shell preview styling.

Selecting a moodboard immediately changes the active design tokens used everywhere else in the designer app.

### Typography Tab

This tab is read-only.

It derives entirely from the selected moodboard and shows:

- font families;
- type scale;
- weights;
- letter spacing;
- line heights;
- canonical usage examples for headings, labels, metadata, body, and monospace protocol text.

### Palette Tab

This tab is read-only.

It derives entirely from the selected moodboard and shows:

- semantic color tokens;
- surface and border tokens;
- interaction and status tokens;
- gradients and atmosphere tokens;
- contrast pairings used by the shared surfaces.

### Components Tab

This tab shows the reusable component library only, not whole product surfaces.

It must inventory all newly designed shared UI components, grouped hierarchically by family:

- tokens and primitives;
- buttons, toggles, chips, badges, inputs, and menus;
- cards, panels, dialogs, rails, toolbars, inspectors, lists, and tables;
- protocol-specific display primitives such as hub chips, identity rows, event rows, file rows, peer rows, and storage rows.

### State Graph Tab

This tab renders the structural UI transition graph.

Requirements:

- graph layout flows from right to left;
- graph layout is automatic and stable;
- the graph supports zoom and pan;
- node and edge styling must match the active moodboard;
- clicking a node sets the live central store to the corresponding structural state;
- when the store matches a node, that node is visually active;
- edges are labelled by exported action-function names;
- the graph is derived from the same transition definitions exported to consumers.

Graph node identity must include only structural UI state such as:

- active shell tab;
- active workspace pane mode;
- active dialog or side panel;
- active create mode;
- active settings section;
- active desktop or phone preview shell mode.

Graph node identity must exclude:

- free-text inputs;
- search strings;
- selected filenames;
- attachment contents;
- chat message text;
- scroll position;
- loaded runtime data payloads.

### Desktop UI Tab

This tab renders the desktop surface library against the live central store.

It must cover the current shared surface inventory, including:

- hub rail and active-hub shell;
- files pane;
- chat pane;
- preview pane;
- timeline panel;
- join hub dialog;
- share hub dialog;
- identity manager;
- create chooser;
- sources and integrations panel;
- storage location panel;
- per-hub storage dialog;
- event flow inspection panel;
- reset dialog.

### Phone UI Tab

This tab renders the same shared surfaces at phone dimensions from the same surface components.

It uses the same central store and the same transition functions as the desktop tab.

Any interaction in the phone preview must update the same live store and therefore also update the state graph and desktop preview as applicable.

## Export Contract

The designer workspace must export the following reusable artifacts.

### 1. Tokens

Palette and typography must be exportable both as:

- TypeScript modules for programmatic consumption;
- CSS entry points exposing stable custom properties and typography classes or mixins.

### 2. Component Library

All reusable UI components must be exported from a stable library entry point with a hierarchical directory structure.

The library must distinguish:

- primitives;
- composites;
- protocol-aware display components.

### 3. Central UI State

The designer workspace must export:

- the root TypeScript type for centralized UI state;
- the initial state factory;
- selectors or derived helpers needed by surfaces;
- the state serializer used by the graph tab and previews.

The root state is a UI-only model. It must not contain transport sessions, sync ownership, backend request state machines, or host-runtime objects.

### 4. Transition Functions

All state transitions used by the designer app must be exported as named pure functions.

These functions are the canonical UI actions for structural state changes, such as:

- `selectShellTab`
- `openJoinDialog`
- `closeJoinDialog`
- `openShareDialog`
- `openIdentityManager`
- `closeOverlay`
- `setWorkspacePaneMode`
- `openPreviewPane`
- `openTimelinePanel`
- `openSourcesPanel`
- `openStoragePanel`
- `openEventFlowPanel`
- `openCreateChooser`
- `openResetDialog`
- `setDevicePreviewMode`

Each function must take the current UI state and return the next UI state without side effects.

### 5. State Graph

The structural state graph must be exported as:

- node definitions;
- edge definitions;
- graph-state keys derived from UI state;
- helpers that map between graph nodes and concrete store snapshots.

### 6. Surface Library

All app surfaces must be exported as Svelte components.

Each surface must accept optional logic-facing props grouped by concern:

- `data`
- `capabilities`
- `handlers`

When those props are omitted, the surface must still render correctly inside the designer app using fixture data and centralized UI state.

When those props are supplied by the real app, the same surface must remain usable without forking markup or styling.

## Required State Shape

The central store must be defined by an explicit TypeScript type rather than ad hoc writable stores spread across components.

The root state must cover at least:

- active designer tab;
- selected moodboard;
- desktop preview shell state;
- phone preview shell state;
- active shared overlays and panels;
- workspace pane mode;
- selected hub identity for presentation;
- component-gallery substate;
- structural graph snapshot identity;
- fixture-variant selections needed to preview empty, populated, warning, and unavailable states.

The store may contain non-structural UI values for rendering previews, but the graph projection must ignore them.

## Implementation Structure

The initial workspace structure is:

```text
ui-designer/
  src/
    app/
      shell/
      tabs/
    lib/
      tokens/
      moodboards/
      state/
      actions/
      graph/
      fixtures/
      components/
      surfaces/
      index.ts
```

Rules:

- `tokens/` owns palette and typography exports.
- `moodboards/` owns curated moodboard definitions and token selection.
- `state/` owns the centralized UI-state type, initial state, and derived selectors.
- `actions/` owns pure transition functions only.
- `graph/` owns graph definitions and layout-facing view models.
- `fixtures/` owns mock data only.
- `components/` owns reusable component library pieces.
- `surfaces/` owns shared app surfaces built from components and UI state.

No surface may import runtime API modules directly.

## Relationship To The Current App

The first implementation step does not replace `ui/`.

Instead it creates a future replacement path:

- `ui/` keeps its current runtime-backed behavior;
- `ui-designer/` proves that the shared UI can exist without runtime ownership;
- later work wires the runtime into exported `data`, `capabilities`, and `handlers` props and then removes duplicate surfaces from `ui/`.

The real app is considered correctly integrated only when:

- it imports palette and typography from the designer exports;
- it imports shared components from the designer exports;
- it imports shared surfaces from the designer exports;
- its runtime layer supplies optional logic props rather than re-owning UI markup.

## Acceptance Criteria

The first implementation is acceptable only if all of the following are true:

- a new Svelte workspace named `ui-designer` exists and boots independently;
- all required tabs exist;
- a selected moodboard drives palette and typography everywhere else in the designer;
- the state graph is live and shares the same central store as the previews;
- desktop and phone previews use the same shared surface components;
- the central UI store is typed and centralized;
- transition functions are exported and correspond to graph edges;
- the designer app renders without backend or sync dependencies;
- reusable exports exist for tokens, components, surfaces, state, actions, and graph helpers.

## Explicit Non-Goals For The First Implementation

- replacing the current `ui/` workspace immediately;
- generating runtime logic from specs in the same change;
- finalizing every future protocol-visualization requirement;
- making the state graph include arbitrary user text or loaded payload content.

Those remain future steps. The first milestone is a real executable UI-only system that the runtime-backed app can later consume directly.
