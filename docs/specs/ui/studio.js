export function createStudioModel(options) {
  var data = options.data;
  var bridge = options.bridge || {};
  var page = options.page || 'overview';
  var STORAGE_KEY = 'nearbytes-ui-studio-v1';
  var surfaceRegistry = bridge.surfaceRegistry || {};
  var toolkitSections = bridge.toolkitSections || [];

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function loadState() {
    var base = clone(data.defaults);
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return normalizeUiState(base);
      return normalizeUiState(Object.assign(base, JSON.parse(raw)));
    } catch (_error) {
      return normalizeUiState(base);
    }
  }

  function saveState(state) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeUiState(state)));
  }

  function normalizeUiState(state) {
    if (bridge.normalizeStudioState) {
      return bridge.normalizeStudioState(state);
    }
    return state;
  }

  function activeMoodboard(state) {
    return data.moodboards.find(function (item) {
      return item.id === state.moodboardId;
    }) || data.moodboards[0];
  }

  function activeHub(state) {
    return data.hubs.find(function (hub) {
      return hub.id === state.hubId;
    }) || data.hubs[0];
  }

  function scalePx(value, factor) {
    var match = /(-?\d+(?:\.\d+)?)px/.exec(String(value || ''));
    if (!match) return value;
    return (Number(match[1]) * factor).toFixed(2).replace(/\.00$/, '') + 'px';
  }

  function applyTokens(root, state) {
    var moodboard = activeMoodboard(state);
    var strength = Math.max(70, Math.min(130, Number(state.accentStrength) || 100));
    var radiusFactor = state.radiusMode === 'crisp' ? 0.84 : state.radiusMode === 'round' ? 1.14 : 1;
    root.setProperty('--bg', moodboard.palette.bg);
    root.setProperty('--paper', moodboard.palette.paper);
    root.setProperty('--panel', moodboard.palette.panel);
    root.setProperty('--ink', moodboard.palette.ink);
    root.setProperty('--muted', moodboard.palette.muted);
    root.setProperty('--line', moodboard.palette.line);
    root.setProperty('--accent', moodboard.palette.accent);
    root.setProperty('--accent-strong', moodboard.palette.accentStrong);
    root.setProperty('--accent-soft', moodboard.palette.accentSoft);
    root.setProperty('--glow', moodboard.palette.glow);
    root.setProperty('--font-display', moodboard.typography.display);
    root.setProperty('--font-body', moodboard.typography.body);
    root.setProperty('--font-mono', moodboard.typography.mono);
    root.setProperty('--radius-xl', scalePx(moodboard.chrome.radiusXl, radiusFactor));
    root.setProperty('--radius-lg', scalePx(moodboard.chrome.radiusLg, radiusFactor));
    root.setProperty('--radius-md', scalePx(moodboard.chrome.radiusMd, radiusFactor));
    root.setProperty('--shadow-lg', moodboard.chrome.shadowLg.replace(/0\.12|0\.10|0\.08/g, function (alpha) {
      return (Math.max(0.06, Number(alpha) * (strength / 100))).toFixed(3);
    }));
    root.setProperty('--shadow-md', moodboard.chrome.shadowMd);
    root.setProperty('--panel-blur', moodboard.chrome.blur);
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function titleCase(value) {
    return value.charAt(0).toUpperCase() + value.slice(1);
  }

  function workspaceLabel(uiState) {
    return uiState.workspace === 'split' ? 'Files and chat' : titleCase(uiState.workspace);
  }

  function dialogLabel(uiState) {
    if (uiState.dialogSurface === 'none') return 'No dialog';
    if (uiState.dialogSurface === 'join') return 'Join hub';
    if (uiState.dialogSurface === 'create') return 'Create';
    if (uiState.dialogSurface === 'identity') return 'Identity manager';
    if (uiState.dialogSurface === 'reset') return 'Reset';
    return 'Share this hub';
  }

  function secondaryLabel(uiState) {
    if (uiState.timelineOpen && uiState.secondary === 'flow') return 'Timeline and event flow';
    if (uiState.timelineOpen) return 'Timeline';
    if (uiState.secondary === 'none') return 'Workspace';
    if (uiState.secondary === 'locations') {
      return uiState.storageMode === 'global' ? 'Storage locations' : 'Hub storage';
    }
    if (uiState.secondary === 'flow') return 'Event flow';
    return 'Identities';
  }

  function filteredFiles(state) {
    var hub = activeHub(state);
    var query = (state.stylesSearchText || '').trim().toLowerCase();
    var files = hub.files.slice();
    if (query) {
      files = files.filter(function (file) {
        return file.name.toLowerCase().indexOf(query) !== -1 || file.meta.toLowerCase().indexOf(query) !== -1;
      });
    }
    if (state.stylesSortValue === 'name') {
      files.sort(function (left, right) {
        return left.name.localeCompare(right.name);
      });
    } else if (state.stylesSortValue === 'protected') {
      files.sort(function (left, right) {
        return Number(/(\d+)/.exec(right.meta)?.[1] || 0) - Number(/(\d+)/.exec(left.meta)?.[1] || 0);
      });
    }
    return files;
  }

  function createStudioSnapshot(uiState, hub, state) {
    if (!bridge.createAppSnapshot) {
      return { surfaces: [], workspaceMode: uiState.workspace, fileManagerViewMode: uiState.viewMode };
    }
    return bridge.createAppSnapshot({
      mountCount: 3,
      mountLabel: hub.name,
      emptyState: false,
      workspaceMode: uiState.workspace,
      showFilesWorkspace: uiState.workspace !== 'chat',
      showChatWorkspace: uiState.workspace !== 'files',
      showSearchWorkspace: uiState.searchOpen,
      fileManagerViewMode: uiState.viewMode,
      fileCount: hub.files.length,
      selectedCount: 1,
      searchQuery: state.stylesSearchText || '',
      showPreviewPane: uiState.workspace !== 'chat',
      showTimeMachinePanel: uiState.timelineOpen,
      timelineCount: hub.timeline.length,
      timelinePosition: hub.timeline.length - 1,
      timelineDetailOpen: uiState.timelineOpen,
      showSourcesPanel: uiState.secondary === 'locations' && uiState.storageMode === 'global',
      showVolumeStoragePanel: uiState.secondary === 'locations' && uiState.storageMode === 'volume',
      showEventFlowPanel: uiState.secondary === 'flow',
      showPhoneOverflowMenu: uiState.phoneMenuOpen,
      showIdentityManager: uiState.secondary === 'identities' || uiState.dialogSurface === 'identity',
      showCreateChooser: uiState.dialogSurface === 'create',
      showJoinVolumeDialog: uiState.dialogSurface === 'join',
      showVolumeShareDialog: uiState.dialogSurface === 'share',
      showResetDialog: uiState.dialogSurface === 'reset',
      activeModal: uiState.dialogSurface,
    });
  }

  function isActiveSurface(snapshot, surfaceId) {
    return snapshot.surfaces.indexOf(surfaceId) !== -1;
  }

  function renderOverview() {
    var surfaceCount = Object.keys(surfaceRegistry).length;
    return ''
      + '<div class="studio-overview">'
      + '<section class="studio-card studio-launcher">'
      + '<h1>UI studio</h1>'
      + '<p class="launcher-copy">This studio now imports the same surface registry the app publishes in development.</p>'
      + '</section>'
      + '<section class="studio-card">'
      + '<div class="quick-links">'
      + '<a class="quick-link-card" href="./moodboard.html"><strong>Moodboard</strong><span class="mood-note">Direction</span></a>'
      + '<a class="quick-link-card" href="./palette.html"><strong>Palette</strong><span class="mood-note">Color system</span></a>'
      + '<a class="quick-link-card" href="./styles.html"><strong>Toolkit</strong><span class="mood-note">' + surfaceCount + ' mapped surfaces</span></a>'
      + '<a class="quick-link-card" href="./graph.html"><strong>Graph</strong><span class="mood-note">State assignments and invocations</span></a>'
      + '<a class="quick-link-card" href="./desktop.html"><strong>Desktop UI</strong><span class="mood-note">Desktop shell</span></a>'
      + '<a class="quick-link-card" href="./phone.html"><strong>Phone UI</strong><span class="mood-note">Phone shell</span></a>'
      + '</div>'
      + '</section>'
      + '</div>';
  }

  function renderMoodboard(state) {
    return ''
      + '<section class="studio-panel">'
      + '<h2>Moodboard</h2>'
      + '<div class="moodboard-grid">'
      + data.moodboards.map(function (item) {
        return '<button type="button" class="mood-card' + (item.id === state.moodboardId ? ' active' : '') + '" data-moodboard="' + item.id + '">'
          + '<strong>' + item.name + '</strong>'
          + '<span class="mood-note">' + item.summary + '</span>'
          + '<div class="mood-strip">'
          + '<span style="background:' + item.palette.bg + '"></span>'
          + '<span style="background:' + item.palette.paper + '"></span>'
          + '<span style="background:' + item.palette.panel + '"></span>'
          + '<span style="background:' + item.palette.accent + '"></span>'
          + '<span style="background:' + item.palette.accentStrong + '"></span>'
          + '</div>'
          + '<div class="mood-spec-grid">'
          + '<div class="mood-spec"><strong>Display</strong><span>' + item.typography.displayLabel + '</span></div>'
          + '<div class="mood-spec"><strong>Body</strong><span>' + item.typography.bodyLabel + '</span></div>'
          + '<div class="mood-spec"><strong>Chrome</strong><span>' + item.chrome.styleLabel + '</span></div>'
          + '<div class="mood-spec"><strong>Radius</strong><span>' + item.chrome.radiusXl + ' / ' + item.chrome.radiusLg + ' / ' + item.chrome.radiusMd + '</span></div>'
          + '</div>'
          + '<div class="token-stack">'
          + item.notes.map(function (note) { return '<span class="token-note">' + note + '</span>'; }).join('')
          + '<span class="token-note"><strong>Shell</strong> ' + item.chrome.shellLabel + '</span>'
          + '</div>'
          + '</button>';
      }).join('')
      + '</div>'
      + '</section>';
  }

  function renderPalette(state) {
    var moodboard = activeMoodboard(state);
    var palette = moodboard.palette;
    var swatches = [['Background', palette.bg], ['Paper', palette.paper], ['Panel', palette.panel], ['Ink', palette.ink], ['Muted', palette.muted], ['Accent', palette.accent], ['Accent strong', palette.accentStrong], ['Accent soft', palette.accentSoft], ['Glow', palette.glow]];
    return ''
      + '<section class="studio-panel">'
      + '<h2>Palette</h2>'
      + '<div class="palette-grid">'
      + swatches.map(function (swatch) { return '<article class="swatch"><div class="swatch-color" style="background:' + swatch[1] + '"></div><strong>' + swatch[0] + '</strong><code>' + swatch[1] + '</code></article>'; }).join('')
      + '</div>'
      + '<div class="palette-grid moodboard-meta-grid">'
      + '<article class="swatch"><strong>Display font</strong><code>' + moodboard.typography.displayLabel + '</code><p class="mood-note">' + moodboard.typography.display + '</p></article>'
      + '<article class="swatch"><strong>Body font</strong><code>' + moodboard.typography.bodyLabel + '</code><p class="mood-note">' + moodboard.typography.body + '</p></article>'
      + '<article class="swatch"><strong>Chrome</strong><code>' + moodboard.chrome.styleLabel + '</code><p class="mood-note">Blur ' + moodboard.chrome.blur + ' · ' + moodboard.chrome.shellLabel + '</p></article>'
      + '</div>'
      + '</section>';
  }

  function renderComponentLab(state, sortLabel, files) {
    var sortOptions = ['Newest first', 'Name A-Z', 'Most protected'];
    return ''
      + '<div class="styles-grid">'
      + '<article class="style-card"><h3 class="section-title">Buttons</h3><div class="component-actions"><button class="style-btn primary">Primary action</button><button class="style-btn ghost">Secondary action</button><button class="style-btn warn">Destructive action</button></div></article>'
      + '<article class="style-card"><h3 class="section-title">Inputs</h3><div class="style-specimen lab"><div class="spec-line"><span class="spec-label">Search input</span><div class="input-row"><input class="styles-input" type="text" value="' + escapeHtml(state.stylesSearchText || '') + '" placeholder="Search files" data-style-input="stylesSearchText"><div class="combo"><button class="combo-trigger" type="button" data-style-combo-toggle="stylesSortOpen">' + sortLabel + '</button>' + (state.stylesSortOpen ? '<div class="combo-list">' + sortOptions.map(function (label, index) { var key = ['newest', 'name', 'protected'][index]; return '<button class="combo-option' + (state.stylesSortValue === key ? ' active' : '') + '" type="button" data-style-option="' + key + '"><strong>' + label + '</strong></button>'; }).join('') + '</div>' : '') + '</div></div></div><div class="lab-meta"><span>' + files.length + ' results</span><span>' + activeHub(state).name + '</span></div></div></article>'
      + '<article class="style-card"><h3 class="section-title">Chips</h3><div class="chip-row"><span class="spec-chip active">Files</span><span class="spec-chip">Chat</span><span class="spec-chip">Storage</span><span class="spec-chip">Flow</span></div></article>'
      + '<article class="style-card"><h3 class="section-title">Status</h3><div class="style-specimen"><div class="status-line warning"><strong>Sync delayed</strong><span>Transport retrying in background.</span></div><div class="status-line success"><strong>Clipboard ready</strong><span>Reference bundle copied.</span></div></div></article>'
      + '<article class="style-card"><h3 class="section-title">Shadows</h3><div class="shadow-stack"><div class="shadow-card inset"><strong>Inset</strong></div><div class="shadow-card soft"><strong>Card</strong></div><div class="shadow-card lifted"><strong>Floating</strong></div></div></article>'
      + '<article class="style-card"><h3 class="section-title">Motion</h3><div class="motion-strip"><div class="motion-card drift"><strong>Traverse</strong></div><div class="motion-card settle"><strong>Settle</strong></div><div class="motion-card pulse"><strong>Pulse</strong></div></div></article>'
      + '</div>';
  }

  function renderToolkitSummary(snapshot) { var activeChips = snapshot.surfaces.map(function (surfaceId) { return '<span class="spec-chip active">' + escapeHtml(surfaceRegistry[surfaceId]?.title || surfaceId) + '</span>'; }).join(''); return '' + '<section class="toolkit-summary-strip">' + '<div><p class="eyebrow">Imported bridge</p><strong>' + snapshot.surfaces.length + ' active surfaces in this shell state</strong></div>' + '<div class="chip-row">' + activeChips + '</div>' + '</section>'; }
  function renderToolkitCard(surfaceId, snapshot, body) { var surface = surfaceRegistry[surfaceId] || { title: surfaceId, component: 'App.svelte', host: '' }; return '' + '<article class="toolkit-spec' + (isActiveSurface(snapshot, surfaceId) ? ' active-surface' : '') + '">' + '<div class="toolkit-spec-head"><div><h4>' + escapeHtml(surface.title) + '</h4><p class="mood-note">' + escapeHtml(surface.host) + '</p></div><div class="component-actions"><span class="toolkit-badge">' + escapeHtml(surface.component) + '</span>' + (isActiveSurface(snapshot, surfaceId) ? '<span class="toolkit-badge live">Active</span>' : '') + '</div></div>' + body + '</article>'; }
  function renderMountRailSpec(hub) { var mounts = data.hubs.map(function (item, index) { return '<button class="mount-chip' + (item.id === hub.id ? ' active' : '') + '"><strong>' + item.name + '</strong><span>' + (index === 0 ? 'Live' : 'Pinned') + '</span></button>'; }).join(''); return '<div class="mount-rail-spec"><div class="mount-rail-column">' + mounts + '</div><div class="mount-rail-detail"><strong>' + hub.name + '</strong><span>' + hub.availableStorage + ' available storage</span><div class="chip-row"><span class="spec-chip active">Files and chat</span><span class="spec-chip">Preview</span></div></div></div>'; }
  function renderWorkspaceBarSpec(uiState, snapshot) { return '<div class="workspace-bar-spec"><div class="chip-row"><span class="spec-chip' + (snapshot.workspaceMode === 'files' ? ' active' : '') + '">Files</span><span class="spec-chip' + (snapshot.workspaceMode === 'chat' ? ' active' : '') + '">Chat</span><span class="spec-chip' + (snapshot.workspaceMode === 'split' ? ' active' : '') + '">Files and chat</span></div><div class="selection-summary"><span>' + snapshot.fileCount + ' files</span><span>' + snapshot.selectedCount + ' selected</span></div><div class="component-actions"><button class="style-btn ghost">Search</button><button class="style-btn ghost">Storage</button><button class="style-btn ghost">Share</button><button class="style-btn ghost">Timeline</button><button class="style-btn ghost">Flow</button></div></div>'; }
  function renderSearchStripSpec(state, sortLabel, files) { return '<div class="style-specimen lab"><div class="input-row"><input class="styles-input" type="text" value="' + escapeHtml(state.stylesSearchText || '') + '" placeholder="Search files" data-style-input="stylesSearchText"><div class="combo"><button class="combo-trigger" type="button" data-style-combo-toggle="stylesSortOpen">' + sortLabel + '</button>' + (state.stylesSortOpen ? '<div class="combo-list"><button class="combo-option' + (state.stylesSortValue === 'newest' ? ' active' : '') + '" type="button" data-style-option="newest"><strong>Newest first</strong></button><button class="combo-option' + (state.stylesSortValue === 'name' ? ' active' : '') + '" type="button" data-style-option="name"><strong>Name A-Z</strong></button><button class="combo-option' + (state.stylesSortValue === 'protected' ? ' active' : '') + '" type="button" data-style-option="protected"><strong>Most protected</strong></button></div>' : '') + '</div></div><div class="selection-summary"><span>' + files.length + ' visible files</span><span>Paste 2 items</span></div></div>'; }
  function renderDetailsViewSpec(hub) { return '<div class="detail-table"><div class="detail-head"><span>Name</span><span>Size</span><span>Updated</span></div>' + hub.files.slice(0, 4).map(function (file, index) { return '<div class="detail-row' + (index === 1 ? ' selected' : '') + '"><div><strong>' + file.name + '</strong><span>' + file.meta + '</span></div><span>' + file.size + '</span><span>' + (index === 0 ? 'Today' : '2m ago') + '</span></div>'; }).join('') + '</div>'; }
  function renderIconViewSpec(hub) { return '<div class="files-grid-icons">' + hub.files.map(function (file) { return '<div class="file-tile"><span class="file-tile-icon">' + file.name.charAt(0).toUpperCase() + '</span><strong>' + file.name + '</strong><span class="list-note">' + file.meta + '</span></div>'; }).join('') + '</div>'; }
  function renderPreviewSpec() { return '<div class="preview-pane-spec"><div class="preview-toolbar"><div><strong>Storyboard.png</strong><div class="mood-note">image/png • 8.1 MB • today</div></div><div class="component-actions"><button class="style-btn ghost">Download</button><button class="style-btn warn">Delete</button></div></div><div class="preview-stage">Preview</div></div>'; }
  function renderChatSpec(hub) { return '<div class="chat-thread">' + hub.chat.map(function (message) { return '<div class="chat-bubble' + (message.self ? ' self' : '') + '">' + escapeHtml(message.text) + '</div>'; }).join('') + '<div class="chat-composer"><input class="styles-input" value="Message ' + escapeHtml(hub.name) + '" readonly><button class="style-btn primary">Send</button></div></div>'; }
  function renderEmptyStateSpec() { return '<div class="empty-spec"><div class="empty-brand">Nearbytes</div><strong>Enter an address to access your files</strong><span>Or drop files here to create a new hub.</span></div>'; }
  function renderTimelineSpec(hub) { return '<div class="preview-pane-spec"><div class="timeline-controls"><strong>Live view</strong><div class="component-actions"><button class="style-btn ghost">Play</button><button class="style-btn ghost">Latest</button></div></div><input class="timeline-slider" type="range" min="0" max="100" value="76"><div class="timeline-event-list">' + hub.timeline.map(function (event, index) { return '<div class="timeline-event-row"><span class="timeline-dot"></span><div><strong>' + event.title + '</strong><span>' + event.note + '</span></div><button class="style-btn ghost">' + (index === hub.timeline.length - 1 ? 'Current' : 'Details') + '</button></div>'; }).join('') + '</div></div>'; }
  function renderTimelineDetailSpec(hub) { return '<div class="dialog-spec"><div class="dialog-spec-head"><div><p class="eyebrow">Event detail</p><strong>' + escapeHtml(hub.timeline[1].title) + '</strong></div><button class="style-btn ghost">Close</button></div><div class="detail-table compact"><div class="detail-row"><div><strong>Kind</strong><span>' + escapeHtml(hub.timeline[1].note) + '</span></div><span>Signed</span><span>Applied</span></div><div class="detail-row"><div><strong>Storage</strong><span>Dropbox, MEGA, local mirror</span></div><span>3 locations</span><span>Reveal</span></div></div></div>'; }
  function renderSourcesPanelSpec(hub) { return '<div class="storage-spec"><div class="chip-row"><span class="spec-chip active">Discovery</span><span class="spec-chip">Defaults</span><span class="spec-chip">Shares</span></div><div class="storage-grid">' + hub.storage.map(function (location) { return '<div class="storage-card"><strong>' + location.title + '</strong><span>' + location.note + '</span><div class="toolkit-badge">' + location.value + '</div></div>'; }).join('') + '</div></div>'; }
  function renderVolumeStorageSpec(hub) { return '<div class="storage-spec"><div class="selection-summary"><span>Default route</span><span>Hub scope</span></div><div class="storage-grid">' + hub.storage.slice(0, 2).map(function (location, index) { return '<div class="storage-card' + (index === 0 ? ' active' : '') + '"><strong>' + location.title + '</strong><span>' + location.note + '</span><div class="component-actions"><span class="toolkit-badge">Read</span><span class="toolkit-badge">Write</span></div></div>'; }).join('') + '</div></div>'; }
  function renderFlowSpec(hub) { return '<div class="flow-spec"><div class="flow-lane">' + hub.flow.map(function (item, index) { return '<div class="flow-node"><span class="flow-step">0' + (index + 1) + '</span><strong>' + item.title + '</strong><span>' + item.note + '</span><div class="toolkit-badge">' + item.value + '</div></div>'; }).join('<div class="flow-link"></div>') + '</div></div>'; }
  function renderShareDialogSpec(hub) { return '<div class="dialog-spec"><div class="dialog-spec-head"><div><p class="eyebrow">Hub link</p><strong>Share ' + escapeHtml(hub.name) + '</strong></div><button class="style-btn ghost">Close</button></div><div class="link-field">nearbytes://join/' + hub.id + '/secure-token</div><div class="component-actions"><button class="style-btn primary">Copy link</button><button class="style-btn ghost">Copy reference</button><button class="style-btn ghost">Storage</button></div></div>'; }
  function renderJoinDialogSpec(hub) { return '<div class="dialog-spec"><div class="dialog-spec-head"><div><p class="eyebrow">Join hub</p><strong>Open a shared hub</strong></div><button class="style-btn ghost">Close</button></div><div class="join-field">Paste join link or encrypted reference bundle</div><div class="detail-row"><div><strong>' + escapeHtml(hub.name) + '</strong><span>Preview ready with credential bootstrap</span></div><span>Preview</span><span>Open</span></div></div>'; }
  function renderMountDialogSpec(hub) { return '<div class="dialog-spec"><div class="dialog-spec-head"><div><p class="eyebrow">Hub properties</p><strong>' + escapeHtml(hub.name) + '</strong></div><button class="style-btn ghost">Close</button></div><div class="detail-table compact"><div class="detail-row"><div><strong>Hub ID</strong><span>' + escapeHtml(hub.id) + '</span></div><span>Copy</span><span>Stored</span></div><div class="detail-row"><div><strong>Storage</strong><span>' + escapeHtml(hub.storage[0]?.title || 'Default location') + '</span></div><span>Change</span><span>Ready</span></div></div></div>'; }
  function renderCreateChooserSpec() { return '<div class="chooser-grid"><button class="chooser-card"><strong>New hub</strong><span>Create from dropped files</span></button><button class="chooser-card"><strong>Join hub</strong><span>Paste a join link</span></button><button class="chooser-card"><strong>Import identity</strong><span>Restore from secret</span></button><button class="chooser-card"><strong>Open storage</strong><span>Configure locations</span></button></div>'; }
  function renderIdentitySpec(hub) { return '<div class="identity-grid">' + hub.identities.map(function (identity, index) { return '<div class="identity-card' + (index === 0 ? ' active' : '') + '"><strong>' + identity.title + '</strong><span>' + identity.note + '</span><div class="component-actions"><span class="toolkit-badge">' + identity.value + '</span>' + (index === 0 ? '<button class="style-btn ghost">Publish</button>' : '') + '</div></div>'; }).join('') + '</div>'; }
  function renderPhoneOverflowSpec(uiState) {
    var actions = ['Search', 'Storage', 'Share', 'Timeline', 'Flow', 'Identities', 'Locations', 'Reset'];
    return '<div class="phone-overflow-spec"><div class="phone-overflow-grid">' + actions.map(function (action) {
      var active = (action === 'Timeline' && uiState.timelineOpen) || (action === 'Flow' && uiState.secondary === 'flow') || (action === 'Storage' && uiState.secondary === 'locations') || (action === 'Identities' && uiState.secondary === 'identities') || (action === 'Reset' && uiState.dialogSurface === 'reset') || (action === 'Share' && uiState.dialogSurface === 'share') || (action === 'Search' && uiState.searchOpen);
      var control = '';
      if (action === 'Search') control = ' data-toggle="searchOpen"';
      if (action === 'Storage') control = ' data-control="secondary" data-value="locations"';
      if (action === 'Share') control = ' data-control="dialogSurface" data-value="share"';
      if (action === 'Timeline') control = ' data-toggle="timelineOpen"';
      if (action === 'Flow') control = ' data-control="secondary" data-value="flow"';
      if (action === 'Identities') control = ' data-control="secondary" data-value="identities"';
      if (action === 'Locations') control = ' data-control="secondary" data-value="locations"';
      if (action === 'Reset') control = ' data-control="dialogSurface" data-value="reset"';
      return '<button type="button" class="overflow-chip' + (active ? ' active' : '') + '"' + control + '>' + action + '</button>';
    }).join('') + '</div></div>';
  }
  function renderResetSpec() { return '<div class="dialog-spec"><div class="status-line warning"><strong>Reset Nearbytes</strong><span>Delete local state and disconnect mounted hubs.</span></div><div class="component-actions"><button class="style-btn warn">Arm reset</button><button class="style-btn ghost">Cancel</button></div></div>'; }
  function renderPrimitivesSpec() { return '<div class="primitive-grid"><div class="primitive-spec"><strong>StatusNotice</strong><div class="status-line warning"><span>History mode blocks deletion.</span></div></div><div class="primitive-spec"><strong>ArmedActionButton</strong><div class="component-actions"><button class="style-btn warn">Arm delete</button><button class="style-btn ghost">Cancel</button></div></div><div class="primitive-spec"><strong>IconToggle</strong><div class="chip-row"><span class="spec-chip active">Icons</span><span class="spec-chip">Details</span></div></div><div class="primitive-spec"><strong>VolumeIdentity</strong><div class="mini-list-row"><div><strong>Ada</strong><span>Published profile</span></div><span>Joined</span></div></div></div>'; }

  function renderSurfaceSpec(surfaceId, snapshot, uiState, hub, files, sortLabel, state) {
    if (surfaceId === 'mount-rail') return renderToolkitCard(surfaceId, snapshot, renderMountRailSpec(hub));
    if (surfaceId === 'workspace-mode-bar') return renderToolkitCard(surfaceId, snapshot, renderWorkspaceBarSpec(uiState, snapshot));
    if (surfaceId === 'workspace-search-strip') return renderToolkitCard(surfaceId, snapshot, renderSearchStripSpec(state, sortLabel, files));
    if (surfaceId === 'file-details-view') return renderToolkitCard(surfaceId, snapshot, renderDetailsViewSpec(hub));
    if (surfaceId === 'file-icon-view') return renderToolkitCard(surfaceId, snapshot, renderIconViewSpec(hub));
    if (surfaceId === 'preview-pane') return renderToolkitCard(surfaceId, snapshot, renderPreviewSpec());
    if (surfaceId === 'chat-thread') return renderToolkitCard(surfaceId, snapshot, renderChatSpec(hub));
    if (surfaceId === 'empty-state') return renderToolkitCard(surfaceId, snapshot, renderEmptyStateSpec());
    if (surfaceId === 'timeline-panel') return renderToolkitCard(surfaceId, snapshot, renderTimelineSpec(hub));
    if (surfaceId === 'timeline-detail') return renderToolkitCard(surfaceId, snapshot, renderTimelineDetailSpec(hub));
    if (surfaceId === 'sources-panel') return renderToolkitCard(surfaceId, snapshot, renderSourcesPanelSpec(hub));
    if (surfaceId === 'volume-storage-panel') return renderToolkitCard(surfaceId, snapshot, renderVolumeStorageSpec(hub));
    if (surfaceId === 'event-flow-panel') return renderToolkitCard(surfaceId, snapshot, renderFlowSpec(hub));
    if (surfaceId === 'share-dialog') return renderToolkitCard(surfaceId, snapshot, renderShareDialogSpec(hub));
    if (surfaceId === 'join-dialog') return renderToolkitCard(surfaceId, snapshot, renderJoinDialogSpec(hub));
    if (surfaceId === 'mount-dialog') return renderToolkitCard(surfaceId, snapshot, renderMountDialogSpec(hub));
    if (surfaceId === 'create-chooser') return renderToolkitCard(surfaceId, snapshot, renderCreateChooserSpec());
    if (surfaceId === 'identity-manager') return renderToolkitCard(surfaceId, snapshot, renderIdentitySpec(hub));
    if (surfaceId === 'phone-overflow-menu') return renderToolkitCard(surfaceId, snapshot, renderPhoneOverflowSpec(uiState));
    if (surfaceId === 'reset-dialog') return renderToolkitCard(surfaceId, snapshot, renderResetSpec());
    return renderToolkitCard(surfaceId, snapshot, renderPrimitivesSpec());
  }

  function renderToolkitSections(snapshot, uiState, hub, files, sortLabel, state) { return toolkitSections.map(function (section) { return '' + '<section class="toolkit-section">' + '<div class="toolkit-section-head"><h3>' + escapeHtml(section.title) + '</h3><span class="toolkit-badge">' + section.surfaces.length + ' surfaces</span></div>' + '<div class="toolkit-spec-grid">' + section.surfaces.map(function (surfaceId) { return renderSurfaceSpec(surfaceId, snapshot, uiState, hub, files, sortLabel, state); }).join('') + '</div>' + '</section>'; }).join(''); }
  function renderStyles(state) { var hub = activeHub(state); var uiState = normalizeUiState(state); var files = filteredFiles(state); var sortLabel = ({ newest: 'Newest first', name: 'Name A-Z', protected: 'Most protected' })[state.stylesSortValue]; var snapshot = createStudioSnapshot(uiState, hub, state); return '' + '<section class="studio-panel">' + '<h2>Toolkit</h2>' + renderToolkitSummary(snapshot) + renderComponentLab(state, sortLabel, files) + renderToolkitSections(snapshot, uiState, hub, files, sortLabel, state) + '</section>'; }
  function renderFiles(hub, uiState) { if (uiState.viewMode === 'icons') return renderIconViewSpec(hub); return '<div class="list-grid">' + hub.files.map(function (file) { return '<div class="list-row"><div><strong>' + file.name + '</strong><span>' + file.meta + '</span></div><span>' + file.size + '</span></div>'; }).join('') + '</div>'; }
  function renderSecondary(hub, uiState) { if (uiState.secondary === 'identities') return renderIdentitySpec(hub); if (uiState.secondary === 'flow') return renderFlowSpec(hub); if (uiState.secondary === 'locations') return uiState.storageMode === 'global' ? renderSourcesPanelSpec(hub) : renderVolumeStorageSpec(hub); return '<div class="summary-card"><strong>Workspace only</strong><p class="shell-note">Secondary surfaces stay out of the way until opened.</p></div>'; }
  function renderDesktopSidebar(hub, uiState) {
    var workspaceSurface = uiState.workspace === 'chat' ? renderChatSpec(hub) : uiState.workspace === 'split' ? renderChatSpec(hub) + renderPreviewSpec() : renderSecondary(hub, uiState);
    return '<div class="secondary-stack"><section class="secondary-pane"><div class="secondary-pane-head"><div><p class="section-kicker">Secondary surface</p><strong>' + secondaryLabel(uiState) + '</strong></div><span>' + dialogLabel(uiState) + '</span></div>' + workspaceSurface + '</section>' + (uiState.timelineOpen ? '<section class="timeline-pane secondary-pane"><div class="secondary-pane-head"><div><p class="section-kicker">Timeline</p><strong>History</strong></div><span>Playback and event detail</span></div>' + renderTimelineSpec(hub) + '</section>' : '') + '</div>';
  }
  function renderPhoneSheetBody(hub, uiState) {
    var surfaces = [];
    if (uiState.timelineOpen) {
      surfaces.push('<section class="timeline-pane secondary-pane"><div class="secondary-pane-head"><div><p class="section-kicker">Timeline</p><strong>History</strong></div><span>Playback and event detail</span></div>' + renderTimelineSpec(hub) + '</section>');
    }
    if (uiState.secondary !== 'none' || !uiState.timelineOpen) {
      surfaces.push('<section class="secondary-pane"><div class="secondary-pane-head"><div><p class="section-kicker">Sheet</p><strong>' + secondaryLabel(uiState) + '</strong></div><span>' + dialogLabel(uiState) + '</span></div>' + renderSecondary(hub, uiState) + '</section>');
    }
    return '<div class="phone-sheet-stack">' + surfaces.join('') + '</div>';
  }
  function renderDialogCard(uiState, hub) { if (uiState.dialogSurface === 'none') return ''; var body = ''; if (uiState.dialogSurface === 'share') body = renderShareDialogSpec(hub); if (uiState.dialogSurface === 'join') body = renderJoinDialogSpec(hub); if (uiState.dialogSurface === 'create') body = renderCreateChooserSpec(); if (uiState.dialogSurface === 'identity') body = renderIdentitySpec(hub); if (uiState.dialogSurface === 'reset') body = renderResetSpec(); return '<div class="dialog-scrim"><div class="dialog-card"><div class="dialog-head"><strong>' + dialogLabel(uiState) + '</strong><button class="style-btn ghost" data-control="dialogSurface" data-value="none">Close</button></div>' + body + '</div></div>'; }
  function renderDesktopShell(state) { var hub = activeHub(state); var uiState = normalizeUiState(state); return '' + '<section class="studio-panel">' + '<div class="ui-page-header"><div><h2>Desktop UI</h2><p>Desktop shell with imported workspace, storage, flow, and dialog vocabulary.</p></div><div class="viewport-switch"><a class="flip-link active" href="./desktop.html">Desktop</a><a class="flip-link" href="./phone.html">Phone</a></div></div>' + '<div class="device-frame desktop"><div class="ui-shell desktop">' + '<header class="shell-header"><div class="brand">Nearbytes</div><div class="hub-pills">' + data.hubs.map(function (item) { return '<button class="hub-pill' + (item.id === state.hubId ? ' active' : '') + '" data-control="hubId" data-value="' + item.id + '">' + item.name + '</button>'; }).join('') + '</div><div class="top-actions"><button class="round-action" data-control="dialogSurface" data-value="create">+</button><button class="shell-action' + (uiState.secondary === 'identities' ? ' active' : '') + '" data-control="secondary" data-value="identities">Identities</button><button class="shell-action' + (uiState.secondary === 'locations' ? ' active' : '') + '" data-control="secondary" data-value="locations">Storage</button></div></header>' + '<div class="shell-route-banner"><strong>' + secondaryLabel(uiState) + '</strong><span>' + workspaceLabel(uiState) + '</span></div>' + '<div class="shell-workspace-bar"><div class="chip-row"><button class="shell-mode' + (uiState.workspace === 'files' ? ' active' : '') + '" data-control="workspace" data-value="files">Files</button><button class="shell-mode' + (uiState.workspace === 'chat' ? ' active' : '') + '" data-control="workspace" data-value="chat">Chat</button><button class="shell-mode' + (uiState.workspace === 'split' ? ' active' : '') + '" data-control="workspace" data-value="split">Files and chat</button></div><div class="shell-workspace-actions"><button class="utility-btn' + (uiState.searchOpen ? ' active' : '') + '" data-toggle="searchOpen">Search</button><button class="utility-btn' + (uiState.secondary === 'locations' ? ' active' : '') + '" data-control="secondary" data-value="locations">Storage</button><button class="utility-btn' + (uiState.dialogSurface === 'share' ? ' active' : '') + '" data-control="dialogSurface" data-value="share">Share</button><button class="utility-btn' + (uiState.timelineOpen ? ' active' : '') + '" data-toggle="timelineOpen">Timeline</button><button class="utility-btn' + (uiState.secondary === 'flow' ? ' active' : '') + '" data-control="secondary" data-value="flow">Flow</button></div></div>' + (uiState.searchOpen ? '<div class="shell-search"><input value="' + escapeHtml(state.stylesSearchText || '') + '" readonly><select><option>Newest</option></select></div>' : '') + '<div class="shell-body desktop"><section class="files-pane"><div class="files-pane-head"><div><p class="section-kicker">Files</p><strong>' + workspaceLabel(uiState) + '</strong></div><span>' + hub.availableStorage + ' available storage</span></div>' + renderFiles(hub, uiState) + '</section>' + renderDesktopSidebar(hub, uiState) + '</div>' + renderDialogCard(uiState, hub) + '</div></div></section>'; }
  function renderPhoneShell(state) { var hub = activeHub(state); var uiState = normalizeUiState(state); return '' + '<section class="studio-panel">' + '<div class="ui-page-header"><div><h2>Phone UI</h2><p>Phone shell with the compact action sheet mapped to the same imported surface registry.</p></div><div class="viewport-switch"><a class="flip-link" href="./desktop.html">Desktop</a><a class="flip-link active" href="./phone.html">Phone</a></div></div>' + '<div class="device-frame phone"><div class="ui-shell phone">' + '<header class="phone-topbar"><div class="brand">Nearbytes</div><div class="hub-pills">' + data.hubs.map(function (item) { return '<button class="hub-pill' + (item.id === state.hubId ? ' active' : '') + '" data-control="hubId" data-value="' + item.id + '">' + item.name + '</button>'; }).join('') + '</div><div class="top-actions"><button class="round-action" data-control="dialogSurface" data-value="create">+</button><button class="round-action" data-toggle="phoneMenuOpen">≡</button></div></header>' + '<div class="phone-switcher"><button class="shell-mode' + (uiState.workspace === 'files' ? ' active' : '') + '" data-control="workspace" data-value="files">Files</button><button class="shell-mode' + (uiState.workspace === 'chat' ? ' active' : '') + '" data-control="workspace" data-value="chat">Chat</button><button class="shell-mode' + (uiState.workspace === 'split' ? ' active' : '') + '" data-control="workspace" data-value="split">Split</button></div>' + '<div class="shell-body phone"><div class="phone-route-banner"><strong>' + secondaryLabel(uiState) + '</strong><span>' + workspaceLabel(uiState) + '</span></div><div class="files-pane"><div class="files-pane-head"><div><p class="section-kicker">Content</p><strong>' + workspaceLabel(uiState) + '</strong></div><span>' + hub.availableStorage + ' available storage</span></div>' + (uiState.workspace === 'chat' ? renderChatSpec(hub) : renderFiles(hub, uiState)) + '</div>' + (uiState.phoneMenuOpen ? renderPhoneOverflowSpec(uiState) : '<div class="phone-overflow-panel"><div class="component-actions"><button class="style-btn ghost" data-toggle="phoneMenuOpen">Open actions</button><button class="style-btn ghost" data-toggle="timelineOpen">Timeline</button><button class="style-btn ghost" data-control="secondary" data-value="locations">Storage</button><button class="style-btn ghost" data-control="secondary" data-value="flow">Flow</button></div></div>') + '<div class="phone-sheet"><div class="phone-sheet-handle"></div>' + renderPhoneSheetBody(hub, uiState) + '</div></div><footer class="phone-footer"><button class="mini-chip' + (uiState.secondary === 'none' && !uiState.timelineOpen ? ' active' : '') + '" data-control="secondary" data-value="none">Content</button><button class="mini-chip' + (uiState.secondary !== 'none' || uiState.timelineOpen ? ' active' : '') + '" data-control="secondary" data-value="locations">Sheet</button></footer>' + renderDialogCard(uiState, hub) + '</div></div></section>'; }

  function renderPageBody(state) { if (page === 'moodboard') return renderMoodboard(state); if (page === 'palette') return renderPalette(state); if (page === 'styles') return renderStyles(state); if (page === 'desktop') return renderDesktopShell(state); if (page === 'phone') return renderPhoneShell(state); if (page === 'graph') return renderOverview(); return renderOverview(); }
  function pageTitle() { if (page === 'moodboard') return 'Nearbytes UI Studio · Moodboard'; if (page === 'palette') return 'Nearbytes UI Studio · Palette'; if (page === 'styles') return 'Nearbytes UI Studio · Styles'; if (page === 'graph') return 'Nearbytes UI Studio · Graph'; if (page === 'desktop') return 'Nearbytes UI Studio · Desktop'; if (page === 'phone') return 'Nearbytes UI Studio · Phone'; return 'Nearbytes UI Studio'; }

  return { loadState: loadState, saveState: saveState, normalizeUiState: normalizeUiState, applyTokens: applyTokens, renderPageBody: renderPageBody, pageTitle: pageTitle };
}