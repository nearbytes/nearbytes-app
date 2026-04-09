(function () {
  const hubs = [
    {
      id: 'studio',
      name: 'Studio notes',
      files: [
        { name: 'Draft notes.pdf', meta: 'Updated 2 minutes ago', size: '2.4 MB' },
        { name: 'Storyboard.png', meta: 'Protected in 3 locations', size: '8.1 MB' },
        { name: 'Voice memo.m4a', meta: 'Synced', size: '912 KB' },
      ],
      chat: [
        { text: 'We can keep the working files in this hub and review the final export after lunch.', self: false },
        { text: 'I moved the notes and the storyboard into the protected copy.', self: true },
        { text: 'Perfect. The history panel should be enough for the review, no extra controls needed.', self: false },
      ],
      sheets: {
        locations: [
          { title: 'Dropbox', note: 'Keeping a full copy', value: '72 GB' },
          { title: 'MEGA', note: 'Incoming share connected', value: '18 GB' },
          { title: 'Mac folder', note: 'Available locally', value: '214 GB' },
        ],
        history: [
          { title: 'Upload storyboard', note: '2 minutes ago', value: 'CREATE_FILE' },
          { title: 'Rename draft', note: '14 minutes ago', value: 'RENAME_FILE' },
          { title: 'Identity publish', note: '27 minutes ago', value: 'APP_RECORD' },
        ],
        flow: [
          { title: 'Hub open', note: 'Materialized from cursor', value: 'stable' },
          { title: 'LAN update', note: 'Pending transport ack', value: 'async' },
          { title: 'Attachment import', note: 'Re-enter through mirror path', value: 'durable' },
        ],
        identities: [
          { title: 'Ada', note: 'Speaking identity for this hub', value: 'active' },
          { title: 'Notebook bot', note: 'Published to identity channel', value: 'published' },
          { title: 'Archive key', note: 'Stored for restore only', value: 'quiet' },
        ],
      },
    },
    {
      id: 'research',
      name: 'Research hub',
      files: [
        { name: 'Paper excerpts.txt', meta: 'Edited on phone', size: '46 KB' },
        { name: 'Scan reference.jpg', meta: 'Protected in 2 locations', size: '4.8 MB' },
        { name: 'Summary draft.md', meta: 'Ready to share', size: '21 KB' },
      ],
      chat: [
        { text: 'The shell should become almost silent unless I ask for something.', self: false },
        { text: 'Then every extra surface goes into the same sheet system.', self: true },
        { text: 'Good. That keeps the phone version understandable.', self: false },
      ],
      sheets: {
        locations: [
          { title: 'iCloud folder', note: 'Keeping a full copy', value: '41 GB' },
          { title: 'Dropbox', note: 'Enabled for new history', value: '72 GB' },
          { title: 'External SSD', note: 'Available nearby', value: '1.4 TB' },
        ],
        history: [
          { title: 'Import scan', note: '5 minutes ago', value: 'CREATE_FILE' },
          { title: 'Join via link', note: '32 minutes ago', value: 'OPEN_HUB' },
          { title: 'Storage rule update', note: '1 hour ago', value: 'APP_RECORD' },
        ],
        flow: [
          { title: 'Discovery refresh', note: 'Provider suggestions merged', value: 'auto' },
          { title: 'Mirror replay', note: 'Applied off-screen', value: 'settled' },
          { title: 'Chat send', note: 'UI returns before transport settle', value: 'optimistic' },
        ],
        identities: [
          { title: 'Ada', note: 'Current speaking identity', value: 'active' },
          { title: 'Reader', note: 'Read-only publication', value: 'published' },
          { title: 'Archive', note: 'Dormant', value: 'quiet' },
        ],
      },
    },
  ];

  const secondaryOptions = ['none', 'locations', 'history', 'flow', 'identities'];
  const modalOptions = ['none', 'create', 'join', 'share', 'reset'];
  const workspaceOptions = ['files', 'chat', 'split'];

  const modalContent = {
    create: {
      title: 'Create hub',
      body: 'A focused creation flow that interrupts the shell and closes through one clear completion or dismissal path.',
      actions: ['Start from scratch', 'Import secret file'],
    },
    join: {
      title: 'Join hub',
      body: 'A dedicated join flow. It is never a side toggle and never shares a grammar with passive inspectors.',
      actions: ['Paste join link', 'Open reference file'],
    },
    share: {
      title: 'Share hub',
      body: 'The share flow remains modal because it produces an object the user may copy, send, or export.',
      actions: ['Create link', 'Copy reference'],
    },
    reset: {
      title: 'Reset app state',
      body: 'Destructive state changes remain isolated from the rest of the shell and are always explicitly dismissible.',
      actions: ['Review reset scope', 'Delete local data'],
    },
  };

  const initialState = {
    viewport: 'desktop',
    hubId: 'studio',
    workspace: 'files',
    secondary: 'locations',
    modal: 'none',
    phoneFocus: 'content',
  };

  const transitions = [
    { trigger: 'selectHub(hubId)', effect: 'hubId := hubId; secondary := secondary === none ? none : secondary; modal := none', note: 'Hub switch keeps the shell, clears modal interruption.' },
    { trigger: 'setWorkspace(mode)', effect: 'workspace := mode', note: 'Files, chat, and split are primary modes, not toggles.' },
    { trigger: 'openSecondary(sheet)', effect: 'secondary := sheet; modal := none', note: 'Only one secondary surface may be visible at a time.' },
    { trigger: 'closeSecondary()', effect: 'secondary := none', note: 'All secondary surfaces close through the same state exit.' },
    { trigger: 'openModal(flow)', effect: 'modal := flow', note: 'Create, join, share, and reset are interruptive flows.' },
    { trigger: 'closeModal()', effect: 'modal := none', note: 'Completion and dismissal both converge on the same clear state.' },
    { trigger: 'setViewport(view)', effect: 'viewport := view', note: 'Phone and desktop share semantics; only presentation differs.' },
  ];

  const stateVariables = [
    {
      name: 'hubId',
      values: 'studio | research',
      entry: 'Set by hub selection.',
      exit: 'Changing hub clears modal to none.',
      invalid: 'Must reference a known hub.',
    },
    {
      name: 'viewport',
      values: 'desktop | phone',
      entry: 'Set by the viewport control.',
      exit: 'No exit side effects.',
      invalid: 'Any value outside the two presentation modes.',
    },
    {
      name: 'workspace',
      values: 'files | chat | split',
      entry: 'Set by the workspace selector.',
      exit: 'No exit side effects.',
      invalid: 'Two primary modes active at once.',
    },
    {
      name: 'secondary',
      values: 'none | locations | history | flow | identities',
      entry: 'Set by the overflow path or direct control.',
      exit: 'Set back to none by close.',
      invalid: 'More than one secondary surface active.',
    },
    {
      name: 'modal',
      values: 'none | create | join | share | reset',
      entry: 'Set by an interruptive action.',
      exit: 'Set back to none by close or completion.',
      invalid: 'More than one modal flow active.',
    },
    {
      name: 'phoneFocus',
      values: 'content | sheet',
      entry: 'Set only for phone rendering inspection.',
      exit: 'No exit side effects.',
      invalid: 'Used as a semantic surface state on desktop.',
    },
  ];

  const invalidCombinations = [
    {
      condition: 'workspace has more than one value',
      reason: 'Primary workspace is exclusive.',
      handling: 'Reject. Keep exactly one of files, chat, or split.',
    },
    {
      condition: 'secondary has more than one value',
      reason: 'Secondary surfaces share one sheet slot.',
      handling: 'Reject. Keep one surface or none.',
    },
    {
      condition: 'modal has more than one value',
      reason: 'Modal flow is singular.',
      handling: 'Reject. Keep one flow or none.',
    },
    {
      condition: 'modal != none and another modal is opened without close',
      reason: 'Modal replacement must be explicit.',
      handling: 'Close current modal first, then open the next one.',
    },
    {
      condition: 'hubId is unknown',
      reason: 'Shell cannot render against missing hub data.',
      handling: 'Fallback to first known hub.',
    },
    {
      condition: 'phoneFocus is used to change desktop semantics',
      reason: 'phoneFocus is a phone inspection variable only.',
      handling: 'Ignore on desktop rendering.',
    },
  ];

  window.NearbytesMockData = {
    hubs,
    secondaryOptions,
    modalOptions,
    workspaceOptions,
    modalContent,
    initialState,
    transitions,
    stateVariables,
    invalidCombinations,
  };
})();
