import appConfig from '../../../app-config.json';
import { DESIGN_MOODBOARDS } from './system/tokens.js';
import { UI_TRANSITION_DEFAULT_STATE } from './system/uiTransitionStore.js';

const moodboards = DESIGN_MOODBOARDS;

const configuredMoodboardId =
  appConfig &&
  typeof appConfig === 'object' &&
  appConfig.studio &&
  typeof appConfig.studio === 'object' &&
  typeof appConfig.studio.moodboardId === 'string'
    ? appConfig.studio.moodboardId
    : null;

const defaultMoodboardId = moodboards.some((item) => item.id === configuredMoodboardId)
  ? configuredMoodboardId
  : moodboards[0]?.id ?? 'harbor-night';

export const STUDIO_DATA = {
    moodboards,
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
      moodboardId: defaultMoodboardId,
      accentStrength: 100,
      radiusMode: 'soft',
      density: 'relaxed',
      viewport: 'desktop',
      hubId: 'studio',
      workspace: 'files',
      secondary: 'none',
      dialogSurface: 'none',
      storageMode: 'volume',
      uiMachine: UI_TRANSITION_DEFAULT_STATE,
      searchOpen: false,
      timelineOpen: false,
      phoneMenuOpen: false,
      viewMode: 'details',
      stylesSearchText: 'story',
      stylesSortValue: 'newest',
      stylesSortOpen: false
    }
};
