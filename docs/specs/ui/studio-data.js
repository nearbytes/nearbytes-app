export const STUDIO_DATA = {
    moodboards: [
      {
        id: 'linen-ledger',
        name: 'Linen Ledger',
        summary: 'Editorial, tactile, calm, paper-first.',
        notes: [
          'Soft daylight, cream paper, brass accent',
          'Quiet luxury without dashboard chrome',
          'Readable long-form density'
        ],
        palette: {
          bg: '#f3ede2',
          paper: 'rgba(255,251,245,0.92)',
          panel: 'rgba(255,255,255,0.78)',
          ink: '#17130f',
          muted: '#6d645d',
          line: 'rgba(41,31,23,0.12)',
          accent: '#245e91',
          accentStrong: '#164162',
          accentSoft: 'rgba(36,94,145,0.12)',
          glow: 'rgba(36,94,145,0.18)'
        },
        typography: {
          display: '"Iowan Old Style", "Palatino Linotype", serif',
          body: '"IBM Plex Sans", "Avenir Next", sans-serif',
          mono: '"IBM Plex Mono", monospace',
          displayLabel: 'Iowan Old Style',
          bodyLabel: 'IBM Plex Sans',
          monoLabel: 'IBM Plex Mono'
        },
        chrome: {
          styleLabel: 'Warm glass',
          shellLabel: 'Cream paper surfaces with long editorial shadows',
          radiusXl: '28px',
          radiusLg: '20px',
          radiusMd: '14px',
          blur: '14px',
          shadowLg: '0 28px 70px rgba(34,25,18,0.12)',
          shadowMd: '0 18px 38px rgba(34,25,18,0.08)'
        }
      },
      {
        id: 'signal-stone',
        name: 'Signal Stone',
        summary: 'Sharper contrast, denser information, clearer system feel.',
        notes: [
          'Stone, graphite, electric blue',
          'Operational confidence over romance',
          'Harder edges and stronger dividers'
        ],
        palette: {
          bg: '#ece8df',
          paper: 'rgba(252,250,246,0.94)',
          panel: 'rgba(255,255,255,0.86)',
          ink: '#101113',
          muted: '#5e646c',
          line: 'rgba(18,22,29,0.12)',
          accent: '#1472c4',
          accentStrong: '#0d4c83',
          accentSoft: 'rgba(20,114,196,0.12)',
          glow: 'rgba(20,114,196,0.20)'
        },
        typography: {
          display: '"Fraunces", "Iowan Old Style", serif',
          body: '"IBM Plex Sans", "Avenir Next", sans-serif',
          mono: '"IBM Plex Mono", monospace',
          displayLabel: 'Fraunces',
          bodyLabel: 'IBM Plex Sans',
          monoLabel: 'IBM Plex Mono'
        },
        chrome: {
          styleLabel: 'Signal glass',
          shellLabel: 'Denser panels, tighter corners, stronger dividers',
          radiusXl: '24px',
          radiusLg: '18px',
          radiusMd: '12px',
          blur: '12px',
          shadowLg: '0 24px 56px rgba(16,17,19,0.12)',
          shadowMd: '0 16px 32px rgba(16,17,19,0.08)'
        }
      },
      {
        id: 'harbor-night',
        name: 'Harbor Night',
        summary: 'Cooler, cinematic, but still light-mode first.',
        notes: [
          'Mist blue, slate, shell white',
          'Atmosphere without losing legibility',
          'More pronounced gradient depth'
        ],
        palette: {
          bg: '#e7edf1',
          paper: 'rgba(252,255,255,0.90)',
          panel: 'rgba(255,255,255,0.84)',
          ink: '#162028',
          muted: '#5f6f7d',
          line: 'rgba(21,37,48,0.12)',
          accent: '#0d7e8f',
          accentStrong: '#07505b',
          accentSoft: 'rgba(13,126,143,0.12)',
          glow: 'rgba(13,126,143,0.18)'
        },
        typography: {
          display: '"Cormorant Garamond", "Iowan Old Style", serif',
          body: '"IBM Plex Sans", "Avenir Next", sans-serif',
          mono: '"IBM Plex Mono", monospace',
          displayLabel: 'Cormorant Garamond',
          bodyLabel: 'IBM Plex Sans',
          monoLabel: 'IBM Plex Mono'
        },
        chrome: {
          styleLabel: 'Mist glass',
          shellLabel: 'Cool gradients, deeper blur, lighter atmospheric chrome',
          radiusXl: '30px',
          radiusLg: '22px',
          radiusMd: '16px',
          blur: '16px',
          shadowLg: '0 28px 64px rgba(21,37,48,0.10)',
          shadowMd: '0 18px 36px rgba(21,37,48,0.08)'
        }
      }
    ],
    hubs: [
      {
        id: 'studio',
        name: 'Studio notes',
        availableStorage: '72 GB',
        files: [
          { name: 'Draft notes.pdf', meta: 'Updated 2 minutes ago', size: '2.4 MB' },
          { name: 'Storyboard.png', meta: 'Protected in 3 locations', size: '8.1 MB' },
          { name: 'Voice memo.m4a', meta: 'Synced', size: '912 KB' },
          { name: 'Research clips.mov', meta: 'Preview ready', size: '81 MB' }
        ],
        chat: [
          { text: 'Draft synced to this hub.', self: false },
          { text: 'Storyboard updated.', self: true },
          { text: 'Preview ready.', self: false }
        ],
        storage: [
          { title: 'Dropbox', note: 'Keeping a full copy', value: '72 GB' },
          { title: 'MEGA', note: 'Incoming share connected', value: '18 GB' },
          { title: 'Mac folder', note: 'Available locally', value: '214 GB' }
        ],
        identities: [
          { title: 'Ada', note: 'Current speaking identity', value: 'Joined' },
          { title: 'Notebook bot', note: 'Published profile', value: 'Published' },
          { title: 'Archive key', note: 'Recovery only', value: 'Quiet' }
        ],
        flow: [
          { title: 'Hub open', note: 'Local mirror applied', value: 'Stable' },
          { title: 'LAN refresh', note: 'Inventory merge', value: 'Async' },
          { title: 'Share copy', note: 'Clipboard payload ready', value: 'Ready' }
        ],
        timeline: [
          { title: 'Draft notes.pdf', note: 'Create file', value: '09:14' },
          { title: 'Storyboard.png', note: 'Rename file', value: '09:19' },
          { title: 'Ada', note: 'Identity publish', value: '09:27' },
          { title: 'Storyboard updated.', note: 'Chat message', value: '09:31' }
        ]
      },
      {
        id: 'research',
        name: 'Research hub',
        availableStorage: '41 GB',
        files: [
          { name: 'Paper excerpts.txt', meta: 'Edited on phone', size: '46 KB' },
          { name: 'Scan reference.jpg', meta: 'Protected in 2 locations', size: '4.8 MB' },
          { name: 'Summary draft.md', meta: 'Ready to share', size: '21 KB' },
          { name: 'Field notes.pages', meta: 'Synced', size: '1.6 MB' }
        ],
        chat: [
          { text: 'Field notes imported.', self: false },
          { text: 'Summary draft updated.', self: true },
          { text: 'Share link copied.', self: false }
        ],
        storage: [
          { title: 'iCloud folder', note: 'Keeping a full copy', value: '41 GB' },
          { title: 'Dropbox', note: 'Enabled for new history', value: '72 GB' },
          { title: 'External SSD', note: 'Available nearby', value: '1.4 TB' }
        ],
        identities: [
          { title: 'Ada', note: 'Current speaking identity', value: 'Joined' },
          { title: 'Reader', note: 'Read-only publication', value: 'Published' },
          { title: 'Archive', note: 'Dormant', value: 'Quiet' }
        ],
        flow: [
          { title: 'Discovery refresh', note: 'Provider suggestions merged', value: 'Auto' },
          { title: 'Mirror replay', note: 'Applied off-screen', value: 'Settled' },
          { title: 'Chat send', note: 'UI returns before transport settle', value: 'Optimistic' }
        ],
        timeline: [
          { title: 'Paper excerpts.txt', note: 'Create file', value: '08:02' },
          { title: 'Reader', note: 'Identity snapshot', value: '08:11' },
          { title: 'Share link copied.', note: 'App record', value: '08:17' },
          { title: 'Field notes.pages', note: 'Delete file', value: '08:32' }
        ]
      }
    ],
    defaults: {
      moodboardId: 'linen-ledger',
      accentStrength: 100,
      radiusMode: 'soft',
      density: 'relaxed',
      viewport: 'desktop',
      hubId: 'studio',
      workspace: 'files',
      secondary: 'none',
      dialogSurface: 'none',
      storageMode: 'volume',
      searchOpen: false,
      timelineOpen: false,
      phoneMenuOpen: false,
      viewMode: 'details',
      stylesSearchText: 'story',
      stylesSortValue: 'newest',
      stylesSortOpen: false
    }
};