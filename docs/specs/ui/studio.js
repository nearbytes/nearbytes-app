(function () {
  var data = window.NearbytesUiStudioData;
  var STORAGE_KEY = 'nearbytes-ui-studio-v1';
  var page = document.body.dataset.page || 'overview';

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function loadState() {
    var base = clone(data.defaults);
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return base;
      return Object.assign(base, JSON.parse(raw));
    } catch (_error) {
      return base;
    }
  }

  var state = loadState();

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function activeMoodboard() {
    return data.moodboards.find(function (item) {
      return item.id === state.moodboardId;
    }) || data.moodboards[0];
  }

  function activeHub() {
    return data.hubs.find(function (hub) {
      return hub.id === state.hubId;
    }) || data.hubs[0];
  }

  function workspaceLabel() {
    return state.workspace === 'split' ? 'Files and chat' : state.workspace.charAt(0).toUpperCase() + state.workspace.slice(1);
  }

  function applyTokens() {
    var moodboard = activeMoodboard();
    var strength = Math.max(70, Math.min(130, Number(state.accentStrength) || 100));
    var radius = state.radiusMode === 'crisp' ? '16px' : state.radiusMode === 'round' ? '32px' : '22px';
    var root = document.documentElement;
    root.style.setProperty('--bg', moodboard.palette.bg);
    root.style.setProperty('--paper', moodboard.palette.paper);
    root.style.setProperty('--panel', moodboard.palette.panel);
    root.style.setProperty('--ink', moodboard.palette.ink);
    root.style.setProperty('--muted', moodboard.palette.muted);
    root.style.setProperty('--line', moodboard.palette.line);
    root.style.setProperty('--accent', moodboard.palette.accent);
    root.style.setProperty('--accent-strong', moodboard.palette.accentStrong);
    root.style.setProperty('--accent-soft', moodboard.palette.accentSoft);
    root.style.setProperty('--glow', moodboard.palette.glow);
    root.style.setProperty('--radius-xl', radius);
    root.style.setProperty('--shadow-lg', '0 28px 70px rgba(34, 25, 18, ' + (strength / 1000).toFixed(3) + ')');
  }

  function renderNav() {
    var links = [
      ['overview', 'Studio', './index.html'],
      ['moodboard', 'Moodboard', './moodboard.html'],
      ['palette', 'Palette', './palette.html'],
      ['styles', 'Toolkit', './styles.html'],
      ['desktop', 'Desktop UI', './desktop.html'],
      ['phone', 'Phone UI', './phone.html']
    ];
    return ''
      + '<section class="studio-nav">'
      + '<div class="studio-top minimal">'
      + '<div>'
      + '<p class="eyebrow">Nearbytes executable UI studio</p>'
      + '<p class="nav-copy">One connected UI spec.</p>'
      + '</div>'
      + '<div class="studio-nav-links">'
      + links.map(function (link) {
        return '<a class="nav-link' + (page === link[0] ? ' active' : '') + '" href="' + link[2] + '">' + link[1] + '</a>';
      }).join('')
      + '</div>'
      + '</div>'
      + '</section>';
  }

  function renderOverview() {
    return ''
      + '<div class="studio-overview">'
      + '<section class="studio-card studio-launcher">'
      + '<p class="eyebrow">Start here</p>'
      + '<h1>UI studio</h1>'
      + '<p class="launcher-copy">Pick a direction, then inspect the desktop and phone shell.</p>'
      + '</section>'
      + '<section class="studio-card">'
      + '<div class="quick-links">'
      + '<a class="quick-link-card" href="./moodboard.html"><strong>Moodboard</strong><span class="mood-note">Choose the atmosphere and visual direction.</span></a>'
      + '<a class="quick-link-card" href="./palette.html"><strong>Palette</strong><span class="mood-note">Inspect the derived color system and token balance.</span></a>'
      + '<a class="quick-link-card" href="./styles.html"><strong>Toolkit</strong><span class="mood-note">Inspect actual app controls, surfaces, dialogs, and primitives.</span></a>'
      + '<a class="quick-link-card" href="./desktop.html"><strong>Desktop UI</strong><span class="mood-note">Inspect the wide product shell.</span></a>'
      + '<a class="quick-link-card" href="./phone.html"><strong>Phone UI</strong><span class="mood-note">Inspect the narrow product shell.</span></a>'
      + '</div>'
      + '</section>';
      + '</div>'
  }

  function renderMoodboard() {
    return ''
      + '<section class="studio-panel">'
      + '<h2>Moodboard</h2>'
      + '<p>Choose the overall feeling first. The palette and UI update from this decision.</p>'
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
          + '<div class="token-stack">'
          + item.notes.map(function (note) {
            return '<span class="token-note">' + note + '</span>';
          }).join('')
          + '</div>'
          + '</button>';
      }).join('')
      + '</div>'
      + '</section>';
  }

  function renderPalette() {
    var palette = activeMoodboard().palette;
    var swatches = [
      ['Background', palette.bg],
      ['Paper', palette.paper],
      ['Panel', palette.panel],
      ['Ink', palette.ink],
      ['Muted', palette.muted],
      ['Accent', palette.accent],
      ['Accent strong', palette.accentStrong],
      ['Accent soft', palette.accentSoft],
      ['Glow', palette.glow]
    ];
    return ''
      + '<section class="studio-panel">'
      + '<h2>Palette</h2>'
      + '<p>The palette is derived from the active moodboard and used everywhere else in the studio.</p>'
      + '<div class="palette-grid">'
      + swatches.map(function (swatch) {
        return '<article class="swatch"><div class="swatch-color" style="background:' + swatch[1] + '"></div><strong>' + swatch[0] + '</strong><code>' + swatch[1] + '</code></article>';
      }).join('')
      + '</div>'
      + '</section>';
  }

  function renderStyles() {
    var sortOptions = {
      newest: 'Newest first',
      name: 'Name A-Z',
      protected: 'Most protected'
    };
    var hub = activeHub();
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
    return ''
      + '<section class="studio-panel">'
      + '<h2>Toolkit</h2>'
      + '<p>This page maps the real app UI vocabulary: actual controls, surfaces, dialogs, and shared primitives.</p>'
      + '<div class="styles-grid">'
      + '<article class="style-card"><h3 class="section-title">Buttons</h3><div class="component-actions"><button class="style-btn primary">Primary action</button><button class="style-btn ghost">Secondary action</button><button class="style-btn warn">Destructive action</button></div></article>'
      + '<article class="style-card"><h3 class="section-title">Inputs</h3><div class="style-specimen lab"><div class="spec-line"><span class="spec-label">Search input</span><div class="input-row"><input class="styles-input" type="text" value="' + escapeHtml(state.stylesSearchText || '') + '" placeholder="Search files" data-style-input="stylesSearchText"><div class="combo"><button class="combo-trigger" type="button" data-style-combo-toggle="stylesSortOpen">' + sortOptions[state.stylesSortValue] + '</button>' + (state.stylesSortOpen ? '<div class="combo-list">' + Object.keys(sortOptions).map(function (key) { return '<button class="combo-option' + (state.stylesSortValue === key ? ' active' : '') + '" type="button" data-style-option="' + key + '"><strong>' + sortOptions[key] + '</strong><span>' + comboHint(key) + '</span></button>'; }).join('') + '</div>' : '') + '</div></div></div><div class="lab-meta"><span>' + files.length + ' results</span><span>' + activeHub().name + '</span></div><div class="lab-results">' + (files.length ? files.map(function (file) { return '<div class="mini-list-row"><div><strong>' + file.name + '</strong><span>' + file.meta + '</span></div><span>' + file.size + '</span></div>'; }).join('') : '<div class="mini-list-row"><div><strong>No results</strong><span>Try a broader query.</span></div><span>0</span></div>') + '</div></div></article>'
      + '<article class="style-card"><h3 class="section-title">Chips</h3><div class="chip-row"><span class="spec-chip active">Files</span><span class="spec-chip">Chat</span><span class="spec-chip">Storage</span><span class="spec-chip">Share</span></div></article>'
      + '<article class="style-card"><h3 class="section-title">Lists</h3><div class="list-grid"><div class="mini-list-row"><div><strong>Draft notes.pdf</strong><span>Updated 2 minutes ago</span></div><span>2.4 MB</span></div><div class="mini-list-row"><div><strong>Storyboard.png</strong><span>Protected in 3 locations</span></div><span>8.1 MB</span></div></div></article>'
      + '<article class="style-card"><h3 class="section-title">Shadows</h3><div class="shadow-stack"><div class="shadow-card inset"><strong>Inset surface</strong><span>Quiet internal depth for contained controls.</span></div><div class="shadow-card soft"><strong>Working card</strong><span>Low lift for everyday content blocks.</span></div><div class="shadow-card lifted"><strong>Floating layer</strong><span>High lift for menus, sheets, and interruptions.</span></div></div></article>'
      + '<article class="style-card"><h3 class="section-title">Motion</h3><div class="motion-strip"><div class="motion-card drift"><strong>Traverse</strong><span>For horizontal movement between siblings.</span></div><div class="motion-card settle"><strong>Settle</strong><span>For entering panels and sheets.</span></div><div class="motion-card pulse"><strong>Pulse</strong><span>For quiet attention, not navigation.</span></div></div></article>'
      + '</div>'
      + renderToolkitSpecs(sortOptions[ state.stylesSortValue ], files)
      + renderToolkitMap()
      + '</section>';
  }

  function renderToolkitSpecs(sortLabel, files) {
    return ''
      + '<div class="toolkit-spec-grid">'
      + '<article class="toolkit-spec"><div class="toolkit-spec-head"><h4>Workspace search strip</h4><p class="mood-note">Real app surface in the file workspace.</p></div><div class="style-specimen lab"><div class="input-row"><input class="styles-input" type="text" value="' + escapeHtml(state.stylesSearchText || '') + '" placeholder="Search files" data-style-input="stylesSearchText"><div class="combo"><button class="combo-trigger" type="button" data-style-combo-toggle="stylesSortOpen">' + sortLabel + '</button>' + (state.stylesSortOpen ? '<div class="combo-list">' + ['newest','name','protected'].map(function (key) { return '<button class="combo-option' + (state.stylesSortValue === key ? ' active' : '') + '" type="button" data-style-option="' + key + '"><strong>' + ({ newest: 'Newest first', name: 'Name A-Z', protected: 'Most protected' })[key] + '</strong><span>' + comboHint(key) + '</span></button>'; }).join('') + '</div>' : '') + '</div></div><div class="selection-summary"><span>' + files.length + ' visible files</span><span>' + (state.viewMode === 'icons' ? 'Icon view' : 'Details view') + '</span></div></div></article>'
      + '<article class="toolkit-spec"><div class="toolkit-spec-head"><h4>Preview pane</h4><p class="mood-note">Metadata head, actions, and preview body.</p></div><div class="preview-pane-spec"><div class="preview-toolbar"><div><strong>Storyboard.png</strong><div class="mood-note">image/png • 8.1 MB • today</div></div><div class="component-actions"><button class="style-btn ghost">Download</button><button class="style-btn warn">Delete</button></div></div><div class="preview-stage">Image / video / audio / PDF / text preview body</div></div></article>'
      + '<article class="toolkit-spec"><div class="toolkit-spec-head"><h4>Timeline and event detail</h4><p class="mood-note">History slider, event rows, and detail open action.</p></div><div class="preview-pane-spec"><div class="timeline-controls"><strong>Live view</strong><div class="component-actions"><button class="style-btn ghost">Play</button><button class="style-btn ghost">Latest</button></div></div><input class="timeline-slider" type="range" min="0" max="100" value="76"><div class="timeline-event-list"><div class="timeline-event-row"><span class="timeline-dot"></span><div><strong>Chat message</strong><span>Storage should feel like a place, not settings.</span></div><button class="style-btn ghost">Details</button></div><div class="timeline-event-row"><span class="timeline-dot"></span><div><strong>Identity publish</strong><span>Notebook bot published to this hub.</span></div><button class="style-btn ghost">Details</button></div></div></div></article>'
      + '<article class="toolkit-spec"><div class="toolkit-spec-head"><h4>Phone overflow menu</h4><p class="mood-note">Actual mobile utility actions from the app shell.</p></div><div class="phone-overflow-spec"><div class="phone-overflow-grid"><div class="overflow-chip">Search</div><div class="overflow-chip">Storage</div><div class="overflow-chip">Share</div><div class="overflow-chip">Timeline</div><div class="overflow-chip">Flow</div><div class="overflow-chip">Identities</div><div class="overflow-chip">Locations</div><div class="overflow-chip">Reset</div></div></div></article>'
      + '<article class="toolkit-spec"><div class="toolkit-spec-head"><h4>Dialog shell</h4><p class="mood-note">Shared AppDialog frame used across storage, share, join, reset, and theme flows.</p></div><div class="dialog-spec"><div class="dialog-spec-head"><div><p class="eyebrow">Hub link</p><strong>Share this hub</strong><p class="mood-note">Choose what to copy and whether storage sharing should open too.</p></div><button class="style-btn ghost">Close</button></div><div class="component-actions"><button class="style-btn primary">Copy link</button><button class="style-btn ghost">Open storage sharing</button></div></div></article>'
      + '<article class="toolkit-spec"><div class="toolkit-spec-head"><h4>Reusable primitives</h4><p class="mood-note">Pieces reused across the app rather than one-off surfaces.</p></div><div class="primitive-grid"><div class="primitive-spec"><strong>StatusNotice</strong><p class="mood-note">Warning, success, error, muted.</p><div class="toolkit-badge">warning</div></div><div class="primitive-spec"><strong>ArmedActionButton</strong><p class="mood-note">Two-step destructive action.</p><div class="component-actions"><button class="style-btn warn">Arm delete</button><button class="style-btn ghost">Cancel</button></div></div><div class="primitive-spec"><strong>IconToggle</strong><p class="mood-note">Compact permission toggle.</p><div class="chip-row"><span class="spec-chip active">Read</span><span class="spec-chip">Write</span></div></div><div class="primitive-spec"><strong>VolumeIdentity</strong><p class="mood-note">Compact hub identity row.</p><div class="mini-list-row"><div><strong>Studio notes</strong><span>Current speaking identity</span></div><span>Joined</span></div></div></div></article>'
      + '</div>';
  }

  function renderToolkitMap() {
    return '<div class="toolkit-map">' + data.toolkitSections.map(function (section) {
      return '<section class="toolkit-section"><div class="toolkit-section-head"><h4>' + section.title + '</h4><p class="mood-note">Real app elements already present in App.svelte or shared components.</p></div><div class="toolkit-item-grid">' + section.items.map(function (item) {
        return '<article class="toolkit-item"><div class="toolkit-meta"><span class="toolkit-badge">' + item.kind + '</span><code class="toolkit-source">' + item.source + '</code></div><h5>' + item.name + '</h5><p class="mood-note">' + item.note + '</p></article>';
      }).join('') + '</div></section>';
    }).join('') + '</div>';
  }

  function comboHint(key) {
    if (key === 'name') return 'Alphabetical order';
    if (key === 'protected') return 'Surfaces replicated items first';
    return 'Most recently updated first';
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderListRows(items) {
    return items.map(function (item) {
      return '<div class="list-row"><div><strong>' + item.title + '</strong><span>' + item.note + '</span></div><span>' + item.value + '</span></div>';
    }).join('');
  }

  function renderFiles(hub) {
    if (state.viewMode === 'icons') {
      return '<div class="files-grid-icons">' + hub.files.map(function (file) {
        return '<div class="file-tile"><span class="file-tile-icon">' + file.name.charAt(0).toUpperCase() + '</span><strong>' + file.name + '</strong><span class="list-note">' + file.meta + '</span></div>';
      }).join('') + '</div>';
    }
    return '<div class="list-grid">' + hub.files.map(function (file) {
      return '<div class="list-row"><div><strong>' + file.name + '</strong><span>' + file.meta + '</span></div><span>' + file.size + '</span></div>';
    }).join('') + '</div>';
  }

  function renderChat(hub) {
    return '<div class="chat-thread">' + hub.chat.map(function (message) {
      return '<div class="chat-bubble' + (message.self ? ' self' : '') + '">' + message.text + '</div>';
    }).join('') + '</div>';
  }

  function renderSecondary(hub) {
    if (state.secondary === 'identities') return renderListRows(hub.identities);
    if (state.secondary === 'flow') return renderListRows(hub.flow);
    return renderListRows(hub.storage);
  }

  function renderDialogCard() {
    if (state.modal === 'none') return '';
    var title = state.modal === 'share' ? 'Share this hub' : 'Create';
    var body = state.modal === 'share' ? 'Generate a link, copy a reference, or inspect storage before sharing.' : 'Choose what to create from one clear interruptive flow.';
    return ''
      + '<div class="dialog-scrim">'
      + '<div class="dialog-card">'
      + '<div class="dialog-head"><strong>' + title + '</strong><button class="style-btn ghost" data-control="modal" data-value="none">Close</button></div>'
      + '<p>' + body + '</p>'
      + '<div class="dialog-actions"><button class="style-btn primary">Primary path</button><button class="style-btn ghost">Secondary path</button></div>'
      + '</div>'
      + '</div>';
  }

  function renderDesktopShell() {
    var hub = activeHub();
    return ''
      + '<section class="studio-panel">'
      + '<div class="ui-page-header"><div><h2>Desktop UI</h2><p>Wide shell with route-level secondary surface and clear header actions.</p></div><div class="viewport-switch"><a class="flip-link active" href="./desktop.html">Desktop</a><a class="flip-link" href="./phone.html">Phone</a></div></div>'
      + '<div class="device-frame desktop">'
      + '<div class="ui-shell desktop">'
      + '<header class="shell-header"><div class="brand">Nearbytes</div><div class="hub-pills">' + data.hubs.map(function (item) {
        return '<button class="hub-pill' + (item.id === state.hubId ? ' active' : '') + '" data-control="hubId" data-value="' + item.id + '">' + item.name + '</button>';
      }).join('') + '</div><div class="top-actions"><button class="round-action" data-control="modal" data-value="create">+</button><button class="shell-action' + (state.secondary === 'identities' ? ' active' : '') + '" data-control="secondary" data-value="identities">Identities</button><button class="shell-action' + (state.secondary === 'locations' ? ' active' : '') + '" data-control="secondary" data-value="locations">Locations</button></div></header>'
      + '<div class="shell-route-banner"><strong>' + (state.secondary === 'none' ? 'Workspace' : state.secondary === 'locations' ? 'Storage location' : state.secondary === 'flow' ? 'Event flow' : 'Identities') + '</strong><span>' + (state.secondary === 'none' ? 'Primary app workspace' : 'Secondary surface opened from the shell') + '</span></div>'
      + '<div class="shell-workspace-bar"><div class="chip-row"><button class="shell-mode' + (state.workspace === 'files' ? ' active' : '') + '" data-control="workspace" data-value="files">Files</button><button class="shell-mode' + (state.workspace === 'chat' ? ' active' : '') + '" data-control="workspace" data-value="chat">Chat</button><button class="shell-mode' + (state.workspace === 'split' ? ' active' : '') + '" data-control="workspace" data-value="split">Files and chat</button></div><div class="shell-workspace-actions"><button class="utility-btn' + (state.searchOpen ? ' active' : '') + '" data-toggle="searchOpen">Search</button><button class="utility-btn' + (state.secondary === 'locations' ? ' active' : '') + '" data-control="secondary" data-value="locations">Storage</button><button class="utility-btn' + (state.modal === 'share' ? ' active' : '') + '" data-control="modal" data-value="share">Share</button><button class="utility-btn' + (state.timelineOpen ? ' active' : '') + '" data-toggle="timelineOpen">Timeline</button><button class="utility-btn' + (state.secondary === 'flow' ? ' active' : '') + '" data-control="secondary" data-value="flow">Flow</button></div></div>'
      + (state.searchOpen ? '<div class="shell-search"><input value="storyboard" readonly><select><option>Newest</option></select></div>' : '')
      + '<div class="shell-body desktop"><section class="files-pane"><div class="files-pane-head"><div><p class="section-kicker">Files</p><strong>' + workspaceLabel() + '</strong></div><span>' + hub.availableStorage + ' available storage</span></div><div class="hero-card"><strong>Product shell</strong><p class="shell-note">Reduced chrome, stronger layout hierarchy, and one understandable action grammar.</p></div>' + renderFiles(hub) + '</section><section class="secondary-pane"><div class="secondary-pane-head"><div><p class="section-kicker">Secondary surface</p><strong>' + (state.secondary === 'none' ? 'Quiet shell' : state.secondary.charAt(0).toUpperCase() + state.secondary.slice(1)) + '</strong></div><span>' + (state.workspace === 'split' ? 'Companion and detail' : 'Focused support') + '</span></div>' + (state.workspace === 'chat' ? renderChat(hub) : state.workspace === 'split' ? renderChat(hub) + '<div class="summary-card"><strong>Preview</strong><p class="shell-note">Desktop can show companion information without inventing another control system.</p></div>' : state.secondary === 'none' ? '<div class="summary-card"><strong>Nothing open</strong><p class="shell-note">The shell is allowed to stay almost empty until the user asks for more.</p></div>' : renderSecondary(hub)) + '</section></div>'
      + renderDialogCard()
      + '</div></div></section>';
  }

  function renderPhoneShell() {
    var hub = activeHub();
    return ''
      + '<section class="studio-panel">'
      + '<div class="ui-page-header"><div><h2>Phone UI</h2><p>Single-column shell with a flip button and one predictable sheet grammar.</p></div><div class="viewport-switch"><a class="flip-link" href="./desktop.html">Desktop</a><a class="flip-link active" href="./phone.html">Phone</a></div></div>'
      + '<div class="device-frame phone">'
      + '<div class="ui-shell phone">'
      + '<header class="phone-topbar"><div class="brand">Nearbytes</div><div class="hub-pills">' + data.hubs.map(function (item) {
        return '<button class="hub-pill' + (item.id === state.hubId ? ' active' : '') + '" data-control="hubId" data-value="' + item.id + '">' + item.name + '</button>';
      }).join('') + '</div><div class="top-actions"><button class="round-action" data-control="modal" data-value="create">+</button><button class="round-action" data-control="secondary" data-value="locations">◌</button></div></header>'
      + '<div class="phone-switcher"><button class="shell-mode' + (state.workspace === 'files' ? ' active' : '') + '" data-control="workspace" data-value="files">Files</button><button class="shell-mode' + (state.workspace === 'chat' ? ' active' : '') + '" data-control="workspace" data-value="chat">Chat</button><button class="shell-mode' + (state.workspace === 'split' ? ' active' : '') + '" data-control="workspace" data-value="split">Split</button></div>'
      + '<div class="shell-body phone"><div class="phone-route-banner"><strong>' + (state.secondary === 'locations' ? 'Storage location' : state.secondary === 'flow' ? 'Event flow' : state.secondary === 'identities' ? 'Identities' : workspaceLabel()) + '</strong><span>' + (state.secondary === 'none' ? 'Current app workspace' : 'Secondary surface') + '</span></div>'
      + '<div class="files-pane"><div class="files-pane-head"><div><p class="section-kicker">Content</p><strong>' + workspaceLabel() + '</strong></div><span>' + hub.availableStorage + ' available storage</span></div><div class="hero-card"><strong>Focused phone shell</strong><p class="shell-note">Single-column rhythm. No competing rails. One clear way to reveal secondary surfaces.</p></div>' + (state.workspace === 'chat' ? renderChat(hub) : renderFiles(hub)) + '</div>'
      + '<div class="phone-overflow-panel"><div class="section-kicker">Utility actions</div><div class="phone-utility-grid"><button class="utility-btn' + (state.searchOpen ? ' active' : '') + '" data-toggle="searchOpen">Search</button><button class="utility-btn' + (state.secondary === 'locations' ? ' active' : '') + '" data-control="secondary" data-value="locations">Storage</button><button class="utility-btn' + (state.modal === 'share' ? ' active' : '') + '" data-control="modal" data-value="share">Share</button><button class="utility-btn' + (state.timelineOpen ? ' active' : '') + '" data-toggle="timelineOpen">Timeline</button><button class="utility-btn' + (state.secondary === 'flow' ? ' active' : '') + '" data-control="secondary" data-value="flow">Flow</button><button class="utility-btn' + (state.secondary === 'identities' ? ' active' : '') + '" data-control="secondary" data-value="identities">Identities</button></div></div>'
      + '<div class="phone-sheet"><div class="phone-sheet-handle"></div><div class="files-pane-head"><div><p class="section-kicker">Sheet</p><strong>' + (state.secondary === 'none' ? 'Storage location' : state.secondary.charAt(0).toUpperCase() + state.secondary.slice(1)) + '</strong></div><span>' + (state.secondary === 'none' ? 'Suggested default' : 'Open surface') + '</span></div>' + renderSecondary(hub) + '</div></div>'
      + '<footer class="phone-footer"><button class="mini-chip' + (state.secondary === 'none' ? ' active' : '') + '" data-control="secondary" data-value="none">Content</button><button class="mini-chip' + (state.secondary !== 'none' ? ' active' : '') + '" data-control="secondary" data-value="locations">Sheet</button></footer>'
      + renderDialogCard()
      + '</div></div></section>';
  }

  function renderControls() {
    return ''
      + '<aside class="studio-controls">'
      + '<section class="control-group"><h3>Moodboard</h3><div class="token-choices">' + data.moodboards.map(function (item) {
        return '<button class="token-btn' + (item.id === state.moodboardId ? ' active' : '') + '" data-moodboard="' + item.id + '">' + item.name + '</button>';
      }).join('') + '</div></section>'
      + '<section class="control-group"><h3>Palette tuning</h3><div class="token-stack"><label class="token-row"><span>Accent</span><input class="range-input" type="range" min="70" max="130" value="' + state.accentStrength + '" data-range="accentStrength"></label><div class="token-choices"><button class="token-btn' + (state.radiusMode === 'crisp' ? ' active' : '') + '" data-radius="crisp">Crisp</button><button class="token-btn' + (state.radiusMode === 'soft' ? ' active' : '') + '" data-radius="soft">Soft</button><button class="token-btn' + (state.radiusMode === 'round' ? ' active' : '') + '" data-radius="round">Round</button></div></div></section>'
      + '<section class="control-group"><h3>Shell state</h3><div class="token-choices"><button class="seg-btn' + (state.workspace === 'files' ? ' active' : '') + '" data-control="workspace" data-value="files">Files</button><button class="seg-btn' + (state.workspace === 'chat' ? ' active' : '') + '" data-control="workspace" data-value="chat">Chat</button><button class="seg-btn' + (state.workspace === 'split' ? ' active' : '') + '" data-control="workspace" data-value="split">Split</button></div><div class="token-choices"><button class="seg-btn' + (state.secondary === 'none' ? ' active' : '') + '" data-control="secondary" data-value="none">No sheet</button><button class="seg-btn' + (state.secondary === 'locations' ? ' active' : '') + '" data-control="secondary" data-value="locations">Storage</button><button class="seg-btn' + (state.secondary === 'flow' ? ' active' : '') + '" data-control="secondary" data-value="flow">Flow</button><button class="seg-btn' + (state.secondary === 'identities' ? ' active' : '') + '" data-control="secondary" data-value="identities">Identities</button></div><div class="token-choices"><button class="seg-btn' + (state.modal === 'none' ? ' active' : '') + '" data-control="modal" data-value="none">No dialog</button><button class="seg-btn' + (state.modal === 'create' ? ' active' : '') + '" data-control="modal" data-value="create">Create</button><button class="seg-btn' + (state.modal === 'share' ? ' active' : '') + '" data-control="modal" data-value="share">Share</button></div><div class="token-choices"><button class="seg-btn' + (state.searchOpen ? ' active' : '') + '" data-toggle="searchOpen">Search</button><button class="seg-btn' + (state.timelineOpen ? ' active' : '') + '" data-toggle="timelineOpen">Timeline</button><button class="seg-btn' + (state.viewMode === 'details' ? ' active' : '') + '" data-view="details">List</button><button class="seg-btn' + (state.viewMode === 'icons' ? ' active' : '') + '" data-view="icons">Tiles</button></div></section>'
      + '</aside>';
  }

  function renderPageBody() {
    if (page === 'moodboard') return renderMoodboard();
    if (page === 'palette') return renderPalette();
    if (page === 'styles') return renderStyles();
    if (page === 'desktop') return renderDesktopShell();
    if (page === 'phone') return renderPhoneShell();
    return renderOverview();
  }

  function render() {
    applyTokens();
    var app = document.getElementById('app');
    if (!app) return;
    var activeElement = document.activeElement;
    var focusDescriptor = null;
    if (
      activeElement instanceof HTMLInputElement &&
      activeElement.hasAttribute('data-style-input')
    ) {
      focusDescriptor = {
        key: activeElement.getAttribute('data-style-input'),
        start: activeElement.selectionStart,
        end: activeElement.selectionEnd
      };
    }
    if (page === 'overview') {
      app.innerHTML = '<div class="studio">' + renderNav() + '<div class="studio-main overview">' + renderPageBody() + '</div></div>';
    } else {
      app.innerHTML = '<div class="studio">' + renderNav() + '<div class="studio-grid"><div class="studio-main">' + renderPageBody() + '</div>' + renderControls() + '</div></div>';
    }
    bind();
    if (focusDescriptor) {
      var nextFocus = document.querySelector('[data-style-input="' + focusDescriptor.key + '"]');
      if (nextFocus instanceof HTMLInputElement) {
        nextFocus.focus();
        if (typeof focusDescriptor.start === 'number' && typeof focusDescriptor.end === 'number') {
          nextFocus.setSelectionRange(focusDescriptor.start, focusDescriptor.end);
        }
      }
    }
    saveState();
  }

  function bind() {
    document.querySelectorAll('[data-moodboard]').forEach(function (element) {
      element.addEventListener('click', function () {
        state.moodboardId = element.getAttribute('data-moodboard') || state.moodboardId;
        render();
      });
    });
    document.querySelectorAll('[data-range]').forEach(function (element) {
      element.addEventListener('input', function () {
        state[element.getAttribute('data-range')] = Number(element.value);
        render();
      });
    });
    document.querySelectorAll('[data-radius]').forEach(function (element) {
      element.addEventListener('click', function () {
        state.radiusMode = element.getAttribute('data-radius');
        render();
      });
    });
    document.querySelectorAll('[data-control]').forEach(function (element) {
      element.addEventListener('click', function () {
        var control = element.getAttribute('data-control');
        var value = element.getAttribute('data-value');
        if (!control) return;
        state[control] = value;
        render();
      });
    });
    document.querySelectorAll('[data-toggle]').forEach(function (element) {
      element.addEventListener('click', function () {
        var key = element.getAttribute('data-toggle');
        state[key] = !state[key];
        render();
      });
    });
    document.querySelectorAll('[data-view]').forEach(function (element) {
      element.addEventListener('click', function () {
        state.viewMode = element.getAttribute('data-view');
        render();
      });
    });
    document.querySelectorAll('[data-style-input]').forEach(function (element) {
      element.addEventListener('input', function () {
        var key = element.getAttribute('data-style-input');
        state[key] = element.value;
        render();
      });
    });
    document.querySelectorAll('[data-style-combo-toggle]').forEach(function (element) {
      element.addEventListener('click', function () {
        var key = element.getAttribute('data-style-combo-toggle');
        state[key] = !state[key];
        render();
      });
    });
    document.querySelectorAll('[data-style-option]').forEach(function (element) {
      element.addEventListener('click', function () {
        state.stylesSortValue = element.getAttribute('data-style-option') || state.stylesSortValue;
        state.stylesSortOpen = false;
        render();
      });
    });
  }

  render();
})();