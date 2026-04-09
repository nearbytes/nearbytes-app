declare module '*.svelte' {
  import type { SvelteComponentTyped } from 'svelte';
  export default class SvelteComponent extends SvelteComponentTyped<Record<string, unknown>> {}
}

declare module '../../docs/specs/ui/components/AppHeader.svelte' {
  import type { SvelteComponentTyped } from 'svelte';
  export default class AppHeader extends SvelteComponentTyped<Record<string, unknown>> {}
}

declare module '../../docs/specs/ui/components/EmptyStatePanel.svelte' {
  import type { SvelteComponentTyped } from 'svelte';
  export default class EmptyStatePanel extends SvelteComponentTyped<Record<string, unknown>> {}
}

declare module '../../docs/specs/ui/components/PhoneOverflowMenu.svelte' {
  import type { SvelteComponentTyped } from 'svelte';
  export default class PhoneOverflowMenu extends SvelteComponentTyped<Record<string, unknown>> {}
}

declare module '../../docs/specs/ui/components/TimeMachinePanel.svelte' {
  import type { SvelteComponentTyped } from 'svelte';
  export default class TimeMachinePanel extends SvelteComponentTyped<Record<string, unknown>> {}
}

declare module '../../docs/specs/ui/components/WorkspaceModeBar.svelte' {
  import type { SvelteComponentTyped } from 'svelte';
  export default class WorkspaceModeBar extends SvelteComponentTyped<Record<string, unknown>> {}
}

declare module '../../docs/specs/ui/components/WorkspaceSearchStrip.svelte' {
  import type { SvelteComponentTyped } from 'svelte';
  export default class WorkspaceSearchStrip extends SvelteComponentTyped<Record<string, unknown>> {}
}

declare module '../../docs/specs/ui/components/WorkspaceStage.svelte' {
  import type { SvelteComponentTyped } from 'svelte';
  export default class WorkspaceStage extends SvelteComponentTyped<Record<string, unknown>> {}
}

declare module '../../../docs/specs/ui/components/PhoneOverflowMenu.svelte' {
  import type { SvelteComponentTyped } from 'svelte';
  export default class PhoneOverflowMenu extends SvelteComponentTyped<Record<string, unknown>> {}
}

declare module '../../../docs/specs/ui/components/WorkspaceModeBar.svelte' {
  import type { SvelteComponentTyped } from 'svelte';
  export default class WorkspaceModeBar extends SvelteComponentTyped<Record<string, unknown>> {}
}

declare module '../../../docs/specs/ui/components/WorkspaceSearchStrip.svelte' {
  import type { SvelteComponentTyped } from 'svelte';
  export default class WorkspaceSearchStrip extends SvelteComponentTyped<Record<string, unknown>> {}
}