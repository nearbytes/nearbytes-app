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
    { id: 'f1', name: 'lan-topology.png', kind: 'image', accent: 'cyan', sizeLabel: '2.8 MB', updatedAt: '5m ago', mimeLabel: 'PNG image', summary: 'Network topology snapshot shared with the current hub.', providers: ['LAN', 'MEGA'], status: 'ready' },
    { id: 'f2', name: 'whitepaper-outline.md', kind: 'document', accent: 'amber', sizeLabel: '48 KB', updatedAt: '22m ago', mimeLabel: 'Markdown', summary: 'Editorial draft mirrored to publishing lanes.', providers: ['GitHub', 'LAN'], status: 'ready' },
    { id: 'f3', name: 'relay-intro.wav', kind: 'audio', accent: 'violet', sizeLabel: '14 MB', updatedAt: '1h ago', mimeLabel: 'Wave audio', summary: 'Voice handoff still flushing encrypted blocks upstream.', providers: ['MEGA', 'Local'], status: 'syncing' },
    { id: 'f4', name: 'handoff-bundle.nb', kind: 'archive', accent: 'rose', sizeLabel: '96 KB', updatedAt: '3h ago', mimeLabel: 'Nearbytes bundle', summary: 'Portable package awaiting readonly provider acknowledgement.', providers: ['MEGA'], status: 'warning' },
  ],
  messages: [
    { id: 'm1', author: 'Vincenzo', body: 'Phone shell now mirrors the desktop surface inventory.', tone: 'local', at: '09:14' },
    { id: 'm2', author: 'Near relay', body: 'LAN peer atlas-03 published 12 fresh objects.', tone: 'system', at: '09:18' },
    { id: 'm3', author: 'Giulia', body: 'Identity publish flow is ready for the shared UI cutover.', tone: 'remote', at: '09:22' },
  ],
  events: [
    { id: 'e1', title: 'File materialized', summary: 'whitepaper-outline.md attached to Atlas Relay', eventType: 'FILE', at: '09:06', tone: 'stable', actor: 'atlas-03', transport: 'LAN source watch -> shared volume', happenedAt: 'Apr 13, 2026 • 09:06:14', payloadPreview: '{"type":"CREATE_FILE","name":"whitepaper-outline.md","blob":"b2a8..."}', specRefs: ['file event envelope', 'volume block projection'], outcome: ['File appears in the latest timeline position.', 'GitHub lane scheduled a mirror write.'] },
    { id: 'e2', title: 'Identity published', summary: 'Giulia / protocol-notes', eventType: 'IDENTITY', at: '09:10', tone: 'stable', actor: 'Giulia', transport: 'Identity publish -> provider sync', happenedAt: 'Apr 13, 2026 • 09:10:42', payloadPreview: '{"type":"PUBLISH_IDENTITY","displayName":"Giulia / protocol-notes"}', specRefs: ['chat identity announcement', 'provider account projection'], outcome: ['Identity is selectable in chat surfaces.', 'Incoming collaborators can resolve the new signer label.'] },
    { id: 'e3', title: 'Chat delivered', summary: 'Designer system milestone announced', eventType: 'CHAT', at: '09:22', tone: 'syncing', actor: 'Near relay', transport: 'Chat channel -> LAN fanout -> MEGA mirror', happenedAt: 'Apr 13, 2026 • 09:22:08', payloadPreview: '{"type":"CHAT_MESSAGE","body":"Designer system milestone announced"}', specRefs: ['chat message envelope', 'replication transport note'], outcome: ['LAN peers already applied the message.', 'MEGA share is still confirming the block upload.'] },
    { id: 'e4', title: 'Transport sync', summary: 'LAN relay atlas-03 caught up', eventType: 'TRANSPORT', at: '09:27', tone: 'attention', actor: 'mega-west', transport: 'Provider recovery -> readonly reconcile', happenedAt: 'Apr 13, 2026 • 09:27:54', payloadPreview: '{"type":"SYNC_STATUS","provider":"MEGA","phase":"reconcile"}', specRefs: ['managed share refresh', 'provider reconcile phase'], outcome: ['Readonly attachment remains visible to users.', 'Write lane is blocked until the helper finishes reconciliation.'] },
  ],
  peers: [
    { id: 'p1', label: 'atlas-03', status: 'reachable', medium: 'LAN' },
    { id: 'p2', label: 'mega-west', status: 'syncing', medium: 'MEGA' },
    { id: 'p3', label: 'local-mirror', status: 'reachable', medium: 'LOCAL' },
  ],
  storageLocations: [
    { id: 's1', label: 'Primary archive', provider: 'Local', status: 'healthy', pathLabel: 'C:/Nearbytes/primary-archive', usageLabel: '412 GB free', reserveLabel: '5% reserve', mode: 'read-write' },
    { id: 's2', label: 'Field laptop cache', provider: 'LAN', status: 'watching', pathLabel: 'atlas-03 / watcher-cache', usageLabel: 'watching 12 pending items', reserveLabel: '10% reserve', mode: 'read-write' },
    { id: 's3', label: 'MEGA handoff lane', provider: 'MEGA', status: 'attention', pathLabel: '/Apps/Nearbytes/atlas-relay', usageLabel: 'helper resync in progress', reserveLabel: '15% reserve', mode: 'read-only' },
  ],
  providerShares: [
    { id: 'ps1', provider: 'LAN', title: 'atlas-03 live relay', status: 'healthy', access: 'read-write', progressPercent: 100, progressLabel: 'Up to date across 3 peers', shareCountLabel: '3 active peers', locationLabel: 'Local network adjacency', detail: 'Primary low-latency lane for file and chat propagation.', attachments: ['Primary archive', 'Field laptop cache'] },
    { id: 'ps2', provider: 'MEGA', title: 'mega-west handoff', status: 'syncing', access: 'read-only', progressPercent: 62, progressLabel: 'Replaying 18 encrypted blocks', shareCountLabel: '1 incoming provider share', locationLabel: '/Apps/Nearbytes/atlas-relay', detail: 'Readonly provider attachment remains authoritative while the helper repairs local divergence.', attachments: ['MEGA handoff lane'] },
    { id: 'ps3', provider: 'GitHub', title: 'design-spec mirror', status: 'healthy', access: 'read-write', progressPercent: null, progressLabel: 'Watching main branch and push queue', shareCountLabel: '2 mirrored folders', locationLabel: 'nearbytes/design-spec', detail: 'Docs lane projects selected files into the review repository.', attachments: ['whitepaper-outline.md', 'spec references'] },
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
      providerShares: [],
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
      providerShares: populatedFixtures.providerShares.map((share, index) => ({
        ...share,
        status: index === 0 ? 'attention' : share.status,
        progressPercent: index === 0 ? 34 : share.progressPercent,
        progressLabel: index === 0 ? 'Waiting for helper confirmation' : share.progressLabel,
      })),
    };
  }

  if (preset === 'capability-limited') {
    return {
      ...populatedFixtures,
      hubs: populatedFixtures.hubs.slice(0, 2),
      storageLocations: populatedFixtures.storageLocations.slice(0, 2),
      providerShares: populatedFixtures.providerShares.slice(0, 2),
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
