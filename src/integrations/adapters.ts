import { isProviderEnabled } from '../config/appConfig.js';
import { GoogleDriveTransportAdapter } from './googleDrive.js';
import { MegaTransportAdapter } from './mega.js';
import type { IntegrationRuntime } from './runtime.js';
import type {
  AcceptManagedShareInput,
  ConnectProviderAccountInput,
  ConnectProviderAccountResult,
  ConfigureProviderInput,
  CreateManagedShareInput,
  InviteManagedShareInput,
  ManagedShare,
  ProviderAccount,
  ProviderCatalogEntry,
  ProviderSetupState,
  TransportEndpoint,
  TransportState,
} from './types.js';

export interface MirrorRemoteEntry {
  readonly path: string;
  readonly size: number;
}

export interface MirrorRemoteAdapter {
  list(): Promise<readonly MirrorRemoteEntry[]>;
  download(path: string): Promise<Uint8Array>;
  upload(path: string, data: Uint8Array): Promise<void>;
}

export interface TransportAdapter {
  readonly provider: string;
  readonly label: string;
  readonly description: string;
  readonly supportsAccountConnection: boolean;
  getSetupState?(): Promise<ProviderSetupState>;
  configure?(input: ConfigureProviderInput): Promise<ProviderSetupState>;
  install?(): Promise<ProviderSetupState>;
  probe(endpoint: TransportEndpoint): Promise<TransportState>;
  connect?(
    input: ConnectProviderAccountInput,
    context?: { callbackBaseUrl?: string }
  ): Promise<ConnectProviderAccountResult>;
  handleOAuthCallback?(query: URLSearchParams): Promise<string>;
  disconnect?(account: ProviderAccount): Promise<void>;
  createManagedShare?(input: CreateManagedShareInput, account: ProviderAccount): Promise<Partial<ManagedShare>>;
  invite?(share: ManagedShare, input: InviteManagedShareInput, account: ProviderAccount): Promise<void>;
  acceptInvite?(input: AcceptManagedShareInput, account: ProviderAccount): Promise<Partial<ManagedShare>>;
  getState?(share: ManagedShare, account: ProviderAccount | null): Promise<TransportState>;
  ensureSync?(share: ManagedShare, account: ProviderAccount): Promise<void>;
  detachManagedShare?(share: ManagedShare, account: ProviderAccount | null): Promise<void>;
}

class StubTransportAdapter implements TransportAdapter {
  constructor(
    readonly provider: string,
    readonly label: string,
    readonly description: string,
    readonly supportsAccountConnection = true
  ) {}

  async probe(endpoint: TransportEndpoint): Promise<TransportState> {
    if (endpoint.transport === 'provider-share' && endpoint.provider?.trim().toLowerCase() === this.provider) {
      return {
        status: 'idle',
        detail: `${this.label} routes are modeled but not yet authenticated by this build.`,
        badges: ['Foundation'],
      };
    }
    return {
      status: 'unsupported',
      detail: `${this.label} does not handle this endpoint.`,
      badges: ['Experimental'],
    };
  }

  async getState(): Promise<TransportState> {
    return {
      status: 'idle',
      detail: `${this.label} is available for planning.`,
      badges: ['Foundation'],
    };
  }
}

export class GitHubTransportAdapter extends StubTransportAdapter {
  constructor() {
    super('github', 'GitHub', 'Immutable read-oriented mirrors distributed through GitHub.', false);
  }
}

export function createDefaultTransportAdapters(runtime: IntegrationRuntime): TransportAdapter[] {
  const adapters: TransportAdapter[] = [];
  if (isProviderEnabled('gdrive')) {
    adapters.push(new GoogleDriveTransportAdapter(runtime));
  }
  if (isProviderEnabled('mega')) {
    adapters.push(new MegaTransportAdapter(runtime));
  }
  if (isProviderEnabled('github')) {
    adapters.push(new GitHubTransportAdapter());
  }
  return adapters;
}

export function createProviderCatalog(
  adapters: readonly TransportAdapter[],
  accounts: readonly ProviderAccount[],
  setupStates: ReadonlyMap<string, ProviderSetupState>
): ProviderCatalogEntry[] {
  const accountByProvider = new Map<string, ProviderAccount>();
  for (const account of accounts) {
    const key = account.provider.trim().toLowerCase();
    if (!accountByProvider.has(key)) {
      accountByProvider.set(key, account);
    }
  }

  return adapters.map((adapter) => {
    const account = accountByProvider.get(adapter.provider);
    return {
      provider: adapter.provider,
      label: adapter.label,
      description: adapter.description,
      badges: account ? [] : adapter.provider === 'gdrive' ? ['OAuth'] : adapter.provider === 'mega' ? ['CLI'] : ['Available'],
      isConnected: account?.state === 'connected',
      connectionState:
        account?.state === 'connected' ? 'connected' : adapter.supportsAccountConnection ? 'available' : 'setup',
      accountId: account?.id,
      setup:
        setupStates.get(adapter.provider) ?? {
          status: 'ready',
          detail: adapter.description,
        },
    } satisfies ProviderCatalogEntry;
  });
}
