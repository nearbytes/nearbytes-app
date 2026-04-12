import { derived, writable, type Readable } from 'svelte/store';
import { applySurfaceAction, createInitialState, setStructuralState } from './actions.js';
import { layoutGraph, structuralStateKey } from './graph.js';
import type {
  GraphNodeId,
  SurfaceAction,
  UiDesignerState,
} from './types.js';

export type UiDesignerStore = ReturnType<typeof createUiDesignerStore>;

export function createUiDesignerStore(initialState: UiDesignerState = createInitialState()) {
  const state = writable<UiDesignerState>(initialState);
  const graph = layoutGraph();
  const activeGraphNode: Readable<GraphNodeId> = derived(state, ($state) =>
    structuralStateKey($state.workspace)
  );

  return {
    subscribe: state.subscribe,
    set: state.set,
    reset: () => state.set(createInitialState()),
    update: state.update,
    graph,
    activeGraphNode,
    dispatchSurfaceAction: (action: SurfaceAction) => state.update((value) => applySurfaceAction(value, action)),
    setStructuralState: (nodeId: GraphNodeId) => state.update((value) => setStructuralState(value, nodeId)),
  };
}
