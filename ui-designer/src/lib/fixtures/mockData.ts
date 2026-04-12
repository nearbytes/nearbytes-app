import type {
  DesignerFixtures,
  FixturePreset,
  SurfaceCapabilities,
} from '../state/types.js';

const populatedFixtures: DesignerFixtures = {
  hubs: [
    { id: 'atlas', label: 'Atlas Relay', members: 6, unreadCount: 3, status: 'active' },
    { id: 'harbor', label: 'Harbor Storage', members: 4, unreadCount: 0, status: 'syncing' },
    { id: 'quiet', label: 'Quiet Archive', members: 2, unreadCount: 1, status: 'warning' },
  ],
  files: [
    { id: 'f1', name: 'lan-topology.png', kind: 'image', sizeLabel: '2.8 MB', updatedAt: '5m ago', status: 'ready' },
    { id: 'f2', name: 'whitepaper-outline.md', kind: 'document', sizeLabel: '48 KB', updatedAt: '22m ago', status: 'ready' },
    { id: 'f3', name: 'relay-intro.wav', kind: 'audio', sizeLabel: '14 MB', updatedAt: '1h ago', status: 'syncing' },
    { id: 'f4', name: 'handoff-bundle.nb', kind: 'archive', sizeLabel: '96 KB', updatedAt: '3h ago', status: 'warning' },
  ],
  messages: [
    { id: 'm1', author: 'Vincenzo', body: 'Phone shell now mirrors the desktop surface inventory.', tone: 'local', at: '09:14' },
    { id: 'm2', author: 'Near relay', body: 'LAN peer atlas-03 published 12 fresh objects.', tone: 'system', at: '09:18' },
    { id: 'm3', author: 'Giulia', body: 'Identity publish flow is ready for the shared UI cutover.', tone: 'remote', at: '09:22' },
  ],
  events: [
    { id: 'e1', title: 'File materialized', summary: 'whitepaper-outline.md attached to Atlas Relay', eventType: 'FILE', at: '09:06' },
    { id: 'e2', title: 'Identity published', summary: 'Giulia / protocol-notes', eventType: 'IDENTITY', at: '09:10' },
    { id: 'e3', title: 'Chat delivered', summary: 'Designer system milestone announced', eventType: 'CHAT', at: '09:22' },
    { id: 'e4', title: 'Transport sync', summary: 'LAN relay atlas-03 caught up', eventType: 'TRANSPORT', at: '09:27' },
  ],
  peers: [
    { id: 'p1', label: 'atlas-03', status: 'reachable', medium: 'LAN' },
    { id: 'p2', label: 'mega-west', status: 'syncing', medium: 'MEGA' },
    { id: 'p3', label: 'local-mirror', status: 'reachable', medium: 'LOCAL' },
  ],
  storageLocations: [
    { id: 's1', label: 'Primary archive', status: 'healthy', reserveLabel: '5% reserve' },
    { id: 's2', label: 'Field laptop cache', status: 'watching', reserveLabel: '10% reserve' },
    { id: 's3', label: 'MEGA handoff lane', status: 'attention', reserveLabel: '15% reserve' },
  ],
  identities: [
    { id: 'i1', displayName: 'Vincenzo / near relay', summary: 'published to Atlas Relay', status: 'published' },
    { id: 'i2', displayName: 'Giulia / protocol-notes', summary: 'joined here', status: 'joined' },
    { id: 'i3', displayName: 'Field demo identity', summary: 'draft and local only', status: 'draft' },
  ],
};

export function buildFixtures(preset: FixturePreset): DesignerFixtures {
  if (preset === 'empty') {
    return {
      ...populatedFixtures,
      files: [],
      messages: [],
      events: [],
      peers: [],
    };
  }

  if (preset === 'warning') {
    return {
      ...populatedFixtures,
      peers: populatedFixtures.peers.map((peer, index) => ({
        ...peer,
        status: index === 0 ? 'limited' : peer.status,
      })),
      storageLocations: populatedFixtures.storageLocations.map((location, index) => ({
        ...location,
        status: index === 0 ? 'attention' : location.status,
      })),
    };
  }

  if (preset === 'capability-limited') {
    return {
      ...populatedFixtures,
      hubs: populatedFixtures.hubs.slice(0, 2),
      storageLocations: populatedFixtures.storageLocations.slice(0, 2),
    };
  }

  return populatedFixtures;
}

export function buildCapabilities(preset: FixturePreset): SurfaceCapabilities {
  if (preset === 'capability-limited') {
    return {
      providers: false,
      desktopHelpers: false,
      lanSync: true,
      destructiveReset: false,
    };
  }

  return {
    providers: true,
    desktopHelpers: true,
    lanSync: true,
    destructiveReset: true,
  };
}
