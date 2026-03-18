export type UiDebugAction =
  | {
      type: 'inspect';
    }
  | {
      type: 'navigate';
      path?: string;
      url?: string;
      waitForLoad?: boolean;
    }
  | {
      type: 'waitFor';
      selector: string;
      state?: 'present' | 'visible' | 'hidden';
      timeoutMs?: number;
      pollIntervalMs?: number;
    }
  | {
      type: 'click';
      selector: string;
    }
  | {
      type: 'type';
      selector: string;
      value: string;
      clear?: boolean;
      submit?: boolean;
    }
  | {
      type: 'pressKey';
      key: string;
      alt?: boolean;
      control?: boolean;
      meta?: boolean;
      shift?: boolean;
    }
  | {
      type: 'read';
      selector: string;
      field?: 'text' | 'html' | 'outerHtml' | 'value';
      attribute?: string;
    }
  | {
      type: 'screenshot';
      path?: string;
      selector?: string;
      fullPage?: boolean;
    };

export interface UiDebugRunRequest {
  readonly actions: UiDebugAction[];
  readonly stopOnError?: boolean;
}

export interface UiDebugActionResult {
  readonly type: UiDebugAction['type'];
  readonly ok: boolean;
  readonly durationMs: number;
  readonly result?: Record<string, unknown>;
  readonly error?: string;
}

export interface UiDebugRunResponse {
  readonly ok: boolean;
  readonly actionCount: number;
  readonly results: UiDebugActionResult[];
}

export interface UiDebugCapabilities {
  readonly available: boolean;
  readonly actions: readonly UiDebugAction['type'][];
  readonly screenshot: boolean;
  readonly title?: string;
  readonly url?: string;
}

export interface UiDebugExecutor {
  getCapabilities(): Promise<UiDebugCapabilities>;
  run(request: UiDebugRunRequest): Promise<UiDebugRunResponse>;
}
