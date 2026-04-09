(function () {
  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function joinClassNames(parts) {
    return parts.filter(Boolean).join(' ');
  }

  function shellRow(item) {
    return '<div class="file-row"><div><strong>' + escapeHtml(item.name || item.title) + '</strong><span>' + escapeHtml(item.meta || item.note || '') + '</span></div><span>' + escapeHtml(item.size || item.value || '') + '</span></div>';
  }

  function renderChatBubble(message) {
    return '<div class="chat-bubble' + (message.self ? ' self' : '') + '">' + escapeHtml(message.text) + '</div>';
  }

  function titleCase(value) {
    return value.charAt(0).toUpperCase() + value.slice(1);
  }

  class NbShellPrototype extends HTMLElement {
    connectedCallback() {
      this.render();
    }

    set model(value) {
      this._model = value;
      this.render();
    }

    get model() {
      return this._model;
    }

    render() {
      if (!this._model) {
        return;
      }

      const model = this._model;
      const hub = model.hub;
      const viewport = model.viewport;
      const secondary = model.secondary;
      const modal = model.modal;
      const isPhone = viewport === 'phone';
      const showSplit = model.workspace === 'split';
      const secondaryRows = secondary !== 'none' ? hub.sheets[secondary].map(shellRow).join('') : '<div class="split-note">No secondary surface open.</div>';
      const modalMarkup = modal !== 'none'
        ? '<div class="modal-scrim"><div class="modal-card"><span class="badge' + (modal === 'reset' ? ' warn' : '') + '">' + escapeHtml(modal) + '</span><h3 class="mock-shell-title">' + escapeHtml(model.modalContent.title) + '</h3><p>' + escapeHtml(model.modalContent.body) + '</p><div class="modal-actions">' + model.modalContent.actions.map(function (label, index) { return '<button class="' + (modal === 'reset' && index === model.modalContent.actions.length - 1 ? 'primary-btn warn' : 'primary-btn') + '">' + escapeHtml(label) + '</button>'; }).join('') + '<button class="ghost-btn" data-action="close-modal">Close</button></div></div></div>'
        : '';

      const workspaceLead = model.workspace === 'files'
        ? { title: 'Hub contents', body: 'The content surface owns the screen. Verbs stay near the content instead of leaking into the shell.' }
        : model.workspace === 'chat'
          ? { title: 'Conversation', body: 'Chat is a first-class workspace mode, not a drawer nested inside file management.' }
          : { title: 'Split composition', body: 'Desktop shows side-by-side focus. Phone remaps split to a stacked composition without changing the state meaning.' };

      const desktopBody = '<div class="shell-body desktop">'
        + '<section class="content-pane">'
        + '<div class="surface-label">' + escapeHtml(model.workspace === 'chat' ? 'Chat' : 'Files') + '</div>'
        + '<div class="workspace-card hero"><h3 class="mock-shell-title">' + escapeHtml(workspaceLead.title) + '</h3><p>' + escapeHtml(workspaceLead.body) + '</p></div>'
        + (model.workspace === 'chat'
          ? '<div class="chat-thread">' + hub.chat.map(renderChatBubble).join('') + '</div>'
          : '<div class="file-list">' + hub.files.map(shellRow).join('') + '</div>')
        + '</section>'
        + '<section class="content-pane">'
        + '<div class="surface-label">' + escapeHtml(showSplit ? 'Companion pane' : 'Focused pane') + '</div>'
        + '<div class="workspace-card"><h3 class="mock-shell-title">' + escapeHtml(showSplit ? 'Companion workspace' : 'Selection context') + '</h3><p>' + escapeHtml(showSplit ? 'The split mode companion stays structurally secondary to the active workspace, not to the shell.' : 'When split is off, the second pane becomes contextual space rather than another permanent toolbar region.') + '</p></div>'
        + (showSplit
          ? '<div class="chat-thread">' + hub.chat.map(renderChatBubble).join('') + '</div>'
          : '<div class="split-note">This pane stays quiet until the current workspace needs supporting context.</div>')
        + '</section>'
        + '<aside class="side-sheet">'
        + '<div class="surface-label">Secondary sheet</div>'
        + '<div class="workspace-card"><h3 class="mock-shell-title">' + escapeHtml(secondary === 'none' ? 'No sheet open' : secondary.charAt(0).toUpperCase() + secondary.slice(1)) + '</h3><p>' + escapeHtml(secondary === 'none' ? 'The shell is allowed to remain almost empty when no secondary surface is needed.' : 'Every secondary surface uses the same sheet grammar and the same close path.') + '</p></div>'
        + '<div class="sheet-list">' + secondaryRows + '</div>'
        + '</aside>'
        + '</div>';

      const phoneSheet = '<div class="phone-sheet"><div class="sheet-handle"></div><div class="surface-label">' + escapeHtml(model.phoneFocus === 'sheet' ? 'Secondary sheet' : 'Surface state') + '</div>'
        + '<div class="workspace-card"><h3 class="mock-shell-title">' + escapeHtml(secondary === 'none' ? 'Quiet shell' : secondary.charAt(0).toUpperCase() + secondary.slice(1)) + '</h3><p>' + escapeHtml(secondary === 'none' ? 'Nothing extra is open. The phone shell remains concentrated on content.' : 'Phone expresses the same secondary state through a takeover sheet with one scroll owner.') + '</p></div>'
        + (secondary === 'none' ? '<div class="split-note">Open the overflow to reveal a secondary surface.</div>' : '<div class="sheet-list">' + secondaryRows + '</div>')
        + '</div>';

      const phoneBody = '<div class="shell-body phone"><div class="phone-content">'
        + '<div class="workspace-card hero"><h3 class="mock-shell-title">' + escapeHtml(model.workspace === 'chat' ? 'Conversation focus' : 'Single-column content') + '</h3><p>' + escapeHtml(model.workspace === 'chat' ? 'Phone gives chat the whole vertical rhythm when selected.' : 'No horizontal overflow. No rail compression. The shell is reduced to hub selection, creation, and secondary access.') + '</p></div>'
        + (model.workspace === 'chat'
          ? '<div class="chat-thread">' + hub.chat.map(renderChatBubble).join('') + '</div>'
          : '<div class="file-list">' + hub.files.map(shellRow).join('') + '</div>')
        + (showSplit ? '<div class="workspace-card"><h3 class="mock-shell-title">Split on phone</h3><p>Split becomes a stacked composition. It does not become a different control system.</p></div><div class="chat-thread">' + hub.chat.map(renderChatBubble).join('') + '</div>' : '')
        + '</div></div>';

      this.innerHTML = ''
        + '<div class="device-shell ' + viewport + '">'
        + '<div class="shell-root ' + viewport + '" style="position:relative;">'
        + '<div class="shell-header">'
        + '<div class="shell-brand">Nearbytes</div>'
        + '<button class="shell-chip grow" data-action="hub-cycle"><span class="chip-label">Hub</span><span class="chip-value">' + escapeHtml(hub.name) + '</span></button>'
        + '<button class="shell-chip icon" data-action="open-create" aria-label="Create hub">+</button>'
        + '<button class="shell-chip icon ' + (secondary !== 'none' ? 'active' : '') + '" data-action="cycle-secondary" aria-label="Secondary surfaces"><span class="ellipsis">...</span></button>'
        + '</div>'
        + '<div class="mode-bar ' + viewport + '">'
        + model.workspaceOptions.map(function (option) {
          if (isPhone && option === 'split') {
            return '<button class="mode-pill" data-action="set-workspace" data-value="split">Split</button>';
          }
          return '<button class="mode-pill ' + (model.workspace === option ? 'active' : '') + ' ' + (isPhone ? 'flex' : '') + '" data-action="set-workspace" data-value="' + escapeHtml(option) + '">' + escapeHtml(titleCase(option)) + '</button>';
        }).join('')
        + '</div>'
        + (isPhone ? phoneBody + phoneSheet + '<div class="phone-footer"><button class="mode-pill ' + (model.phoneFocus === 'content' ? 'active' : '') + '" data-action="phone-focus" data-value="content">Content</button><button class="mode-pill ' + (model.phoneFocus === 'sheet' ? 'active' : '') + '" data-action="phone-focus" data-value="sheet">Sheet</button></div>' : desktopBody)
        + modalMarkup
        + '</div></div>';
    }
  }

  class NbStateMachineView extends HTMLElement {
    connectedCallback() {
      this.render();
    }

    set model(value) {
      this._model = value;
      this.render();
    }

    get model() {
      return this._model;
    }

    render() {
      if (!this._model) {
        return;
      }

      const model = this._model;
      const secondaryStates = model.secondaryOptions.map(function (value) {
        return '<div class="state-pill ' + (model.secondary === value ? 'is-active' : '') + '">' + escapeHtml(value) + '</div>';
      }).join('');
      const modalStates = model.modalOptions.map(function (value) {
        const warn = value === 'reset' ? ' warn' : '';
        return '<div class="state-pill ' + (model.modal === value ? 'is-active' : '') + warn + '">' + escapeHtml(value) + '</div>';
      }).join('');
      const workspaceStates = model.workspaceOptions.map(function (value) {
        return '<div class="state-pill ' + (model.workspace === value ? 'is-active' : '') + '">' + escapeHtml(value) + '</div>';
      }).join('');

      this.innerHTML = ''
        + '<div class="machine-grid">'
        + '<div class="machine-stage">'
        + '<div class="machine-svg-wrap">'
        + '<svg class="machine-svg" viewBox="0 0 1100 760" role="img" aria-label="Nearbytes prototype state machine">'
        + '<defs><marker id="prototype-arrow" markerWidth="10" markerHeight="10" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#655a50"></path></marker></defs>'
        + '<rect x="40" y="40" width="1020" height="680" rx="30" fill="rgba(255,255,255,0.46)" stroke="rgba(41,31,23,0.10)"></rect>'
        + '<rect x="80" y="86" width="940" height="128" rx="24" fill="rgba(36,94,145,0.10)" stroke="rgba(36,94,145,0.18)"></rect>'
        + '<text x="112" y="124" font-family="IBM Plex Sans, sans-serif" font-size="14" fill="#245e91" letter-spacing="1.5">VARIABLES · SHELL</text>'
        + '<rect x="114" y="144" width="220" height="42" rx="21" fill="#fffdf8" stroke="rgba(41,31,23,0.14)"></rect>'
        + '<text x="148" y="170" font-family="IBM Plex Sans, sans-serif" font-size="16" fill="#17130f">hubId = ' + escapeHtml(model.hub.id) + '</text>'
        + '<rect x="354" y="144" width="206" height="42" rx="21" fill="#fffdf8" stroke="rgba(41,31,23,0.14)"></rect>'
        + '<text x="388" y="170" font-family="IBM Plex Sans, sans-serif" font-size="16" fill="#17130f">viewport = ' + escapeHtml(model.viewport) + '</text>'
        + '<rect x="580" y="144" width="250" height="42" rx="21" fill="#fffdf8" stroke="rgba(41,31,23,0.14)"></rect>'
        + '<text x="614" y="170" font-family="IBM Plex Sans, sans-serif" font-size="16" fill="#17130f">phoneFocus = ' + escapeHtml(model.phoneFocus) + '</text>'
        + '<text x="112" y="202" font-family="IBM Plex Sans, sans-serif" font-size="13" fill="#6d645d">Shell variables define context. They do not directly open modal flows or mutate secondary surfaces.</text>'
        + '<rect x="80" y="244" width="940" height="126" rx="24" fill="rgba(15,118,110,0.10)" stroke="rgba(15,118,110,0.18)"></rect>'
        + '<text x="112" y="282" font-family="IBM Plex Sans, sans-serif" font-size="14" fill="#0f766e" letter-spacing="1.5">VARIABLES · PRIMARY WORKSPACE</text>'
        + '<rect x="114" y="302" width="190" height="42" rx="21" fill="#fffdf8" stroke="rgba(41,31,23,0.14)"></rect>'
        + '<text x="162" y="328" font-family="IBM Plex Sans, sans-serif" font-size="16" fill="#17130f">files</text>'
        + '<rect x="322" y="302" width="190" height="42" rx="21" fill="#fffdf8" stroke="rgba(41,31,23,0.14)"></rect>'
        + '<text x="377" y="328" font-family="IBM Plex Sans, sans-serif" font-size="16" fill="#17130f">chat</text>'
        + '<rect x="530" y="302" width="190" height="42" rx="21" fill="#fffdf8" stroke="rgba(41,31,23,0.14)"></rect>'
        + '<text x="582" y="328" font-family="IBM Plex Sans, sans-serif" font-size="16" fill="#17130f">split</text>'
        + '<rect x="738" y="302" width="234" height="42" rx="21" fill="rgba(36,94,145,0.12)" stroke="rgba(36,94,145,0.18)"></rect>'
        + '<text x="768" y="328" font-family="IBM Plex Sans, sans-serif" font-size="16" fill="#164162">workspace = ' + escapeHtml(model.workspace) + '</text>'
        + '<rect x="80" y="402" width="458" height="270" rx="24" fill="rgba(255,255,255,0.72)" stroke="rgba(41,31,23,0.14)"></rect>'
        + '<text x="112" y="438" font-family="IBM Plex Sans, sans-serif" font-size="14" fill="#245e91" letter-spacing="1.5">VARIABLES · SECONDARY SURFACE</text>'
        + '<rect x="114" y="458" width="170" height="36" rx="18" fill="#fdfaf3" stroke="rgba(41,31,23,0.14)"></rect>'
        + '<text x="168" y="481" font-family="IBM Plex Sans, sans-serif" font-size="15" fill="#17130f">none</text>'
        + '<rect x="114" y="508" width="170" height="36" rx="18" fill="#fdfaf3" stroke="rgba(41,31,23,0.14)"></rect>'
        + '<text x="148" y="531" font-family="IBM Plex Sans, sans-serif" font-size="15" fill="#17130f">locations</text>'
        + '<rect x="300" y="508" width="150" height="36" rx="18" fill="#fdfaf3" stroke="rgba(41,31,23,0.14)"></rect>'
        + '<text x="346" y="531" font-family="IBM Plex Sans, sans-serif" font-size="15" fill="#17130f">history</text>'
        + '<rect x="114" y="558" width="150" height="36" rx="18" fill="#fdfaf3" stroke="rgba(41,31,23,0.14)"></rect>'
        + '<text x="168" y="581" font-family="IBM Plex Sans, sans-serif" font-size="15" fill="#17130f">flow</text>'
        + '<rect x="280" y="558" width="170" height="36" rx="18" fill="#fdfaf3" stroke="rgba(41,31,23,0.14)"></rect>'
        + '<text x="322" y="581" font-family="IBM Plex Sans, sans-serif" font-size="15" fill="#17130f">identities</text>'
        + '<rect x="114" y="614" width="336" height="38" rx="19" fill="rgba(36,94,145,0.12)" stroke="rgba(36,94,145,0.18)"></rect>'
        + '<text x="150" y="638" font-family="IBM Plex Sans, sans-serif" font-size="15" fill="#164162">secondary = ' + escapeHtml(model.secondary) + '</text>'
        + '<rect x="562" y="402" width="458" height="270" rx="24" fill="rgba(165,72,46,0.08)" stroke="rgba(165,72,46,0.14)"></rect>'
        + '<text x="594" y="438" font-family="IBM Plex Sans, sans-serif" font-size="14" fill="#a5482e" letter-spacing="1.5">VARIABLES · MODAL FLOW</text>'
        + '<rect x="596" y="458" width="152" height="36" rx="18" fill="#fffdf8" stroke="rgba(41,31,23,0.14)"></rect>'
        + '<text x="640" y="481" font-family="IBM Plex Sans, sans-serif" font-size="15" fill="#17130f">none</text>'
        + '<rect x="596" y="508" width="168" height="36" rx="18" fill="#fffdf8" stroke="rgba(41,31,23,0.14)"></rect>'
        + '<text x="636" y="531" font-family="IBM Plex Sans, sans-serif" font-size="15" fill="#17130f">create</text>'
        + '<rect x="780" y="508" width="122" height="36" rx="18" fill="#fffdf8" stroke="rgba(41,31,23,0.14)"></rect>'
        + '<text x="819" y="531" font-family="IBM Plex Sans, sans-serif" font-size="15" fill="#17130f">join</text>'
        + '<rect x="596" y="558" width="122" height="36" rx="18" fill="#fffdf8" stroke="rgba(41,31,23,0.14)"></rect>'
        + '<text x="636" y="581" font-family="IBM Plex Sans, sans-serif" font-size="15" fill="#17130f">share</text>'
        + '<rect x="736" y="558" width="122" height="36" rx="18" fill="#fffdf8" stroke="rgba(41,31,23,0.14)"></rect>'
        + '<text x="778" y="581" font-family="IBM Plex Sans, sans-serif" font-size="15" fill="#17130f">reset</text>'
        + '<rect x="596" y="614" width="306" height="38" rx="19" fill="rgba(165,72,46,0.12)" stroke="rgba(165,72,46,0.18)"></rect>'
        + '<text x="628" y="638" font-family="IBM Plex Sans, sans-serif" font-size="15" fill="#8a4028">modal = ' + escapeHtml(model.modal) + '</text>'
        + '<path d="M548 186 V244" stroke="#655a50" stroke-width="1.5" marker-end="url(#prototype-arrow)"></path>'
        + '<path d="M794 186 V402" stroke="#655a50" stroke-width="1.5" marker-end="url(#prototype-arrow)"></path>'
        + '<path d="M418 344 V402" stroke="#655a50" stroke-width="1.5" marker-end="url(#prototype-arrow)"></path>'
        + '</svg>'
        + '</div>'
        + '</div>'
        + '</div>';
    }
  }

  window.customElements.define('nb-shell-prototype', NbShellPrototype);
  window.customElements.define('nb-state-machine-view', NbStateMachineView);
})();
