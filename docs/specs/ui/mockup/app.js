(function () {
  const data = window.NearbytesMockData;

  function cloneState() {
    return JSON.parse(JSON.stringify(data.initialState));
  }

  const state = cloneState();

  function nextInList(list, current) {
    const index = list.indexOf(current);
    return list[(index + 1) % list.length];
  }

  function getHub() {
    return data.hubs.find(function (hub) {
      return hub.id === state.hubId;
    }) || data.hubs[0];
  }

  function getModel(viewportOverride) {
    return {
      viewport: viewportOverride || state.viewport,
      hub: getHub(),
      workspace: state.workspace,
      secondary: state.secondary,
      modal: state.modal,
      phoneFocus: state.phoneFocus,
      modalContent: state.modal === 'none' ? null : data.modalContent[state.modal],
      workspaceOptions: data.workspaceOptions,
      secondaryOptions: data.secondaryOptions,
      modalOptions: data.modalOptions,
    };
  }

  function stateJson() {
    return JSON.stringify({
      hub: getHub().name,
      viewport: state.viewport,
      workspace: state.workspace,
      secondary: state.secondary,
      modal: state.modal,
      phoneFocus: state.phoneFocus,
    }, null, 2);
  }

  function renderVariableGrid() {
    return ''
      + '<div class="variable-grid">'
      + '<div class="variable-card"><div class="surface-label">Shell context</div><div class="variables">'
      + '<div class="variable-row"><span class="variable-key">hub</span><span class="variable-value">' + getHub().name + '</span></div>'
      + '<div class="variable-row"><span class="variable-key">viewport</span><span class="variable-value">' + state.viewport + '</span></div>'
      + '<div class="variable-row"><span class="variable-key">phoneFocus</span><span class="variable-value">' + state.phoneFocus + '</span></div>'
      + '</div></div>'
      + '<div class="variable-card"><div class="surface-label">Active surfaces</div><div class="variables">'
      + '<div class="variable-row"><span class="variable-key">workspace</span><span class="variable-value">' + state.workspace + '</span></div>'
      + '<div class="variable-row"><span class="variable-key">secondary</span><span class="variable-value">' + state.secondary + '</span></div>'
      + '<div class="variable-row"><span class="variable-key">modal</span><span class="variable-value">' + state.modal + '</span></div>'
      + '</div></div>'
      + '</div>';
  }

  function renderReadingGuide() {
    return ''
      + '<section class="surface">'
      + '<span class="badge">Reading guide</span>'
      + '<h2>Terms used on this page</h2>'
      + '<div class="guide-grid">'
      + '<div class="guide-card"><strong>Two UIs</strong><p>The large canvas is the desktop UI. The narrow canvas is the phone UI. Both are shown at the same time below.</p></div>'
      + '<div class="guide-card"><strong>Hub</strong><p>The current Nearbytes space. “Studio notes” and “Research hub” are example hub names.</p></div>'
      + '<div class="guide-card"><strong>Workspace</strong><p>The main mode: files, chat, or split.</p></div>'
      + '<div class="guide-card"><strong>Secondary surface</strong><p>The extra sheet opened from the overflow control.</p></div>'
      + '<div class="guide-card"><strong>Modal</strong><p>The interruptive flow such as create, join, share, or reset.</p></div>'
      + '</div>'
      + '</section>';
  }

  function renderTransitions() {
    return data.transitions.map(function (transition) {
      return ''
        + '<div class="transition-row">'
        + '<div><strong>' + transition.trigger + '</strong><span>' + transition.note + '</span></div>'
        + '<span>' + transition.effect + '</span>'
        + '</div>';
    }).join('');
  }

  function renderStateVariableTable() {
    return ''
      + '<div class="table-wrap">'
      + '<table class="machine-table">'
      + '<thead><tr><th>Variable</th><th>Allowed values</th><th>Entry</th><th>Exit</th><th>Invalid state</th></tr></thead>'
      + '<tbody>'
      + data.stateVariables.map(function (item) {
        return '<tr>'
          + '<td><code>' + item.name + '</code></td>'
          + '<td>' + item.values + '</td>'
          + '<td>' + item.entry + '</td>'
          + '<td>' + item.exit + '</td>'
          + '<td>' + item.invalid + '</td>'
          + '</tr>';
      }).join('')
      + '</tbody></table></div>';
  }

  function renderInvalidCombinationTable() {
    return ''
      + '<div class="table-wrap">'
      + '<table class="machine-table">'
      + '<thead><tr><th>Condition</th><th>Reason</th><th>Handling</th></tr></thead>'
      + '<tbody>'
      + data.invalidCombinations.map(function (item) {
        return '<tr>'
          + '<td>' + item.condition + '</td>'
          + '<td>' + item.reason + '</td>'
          + '<td>' + item.handling + '</td>'
          + '</tr>';
      }).join('')
      + '</tbody></table></div>';
  }

  function renderControls() {
    return ''
      + '<div class="surface">'
      + '<span class="badge">Controls</span>'
      + '<h2>State</h2>'
      + '<p>These controls change the shared state object. The previews stay side by side. The viewport value belongs to the state model and is emphasized in the machine view.</p>'
      + '<div class="controls">'
      + '<div class="segmented" role="group" aria-label="Viewport variable">'
      + '<button class="segment-btn ' + (state.viewport === 'desktop' ? 'is-active' : '') + '" data-control="viewport" data-value="desktop">Viewport: desktop</button>'
      + '<button class="segment-btn ' + (state.viewport === 'phone' ? 'is-active' : '') + '" data-control="viewport" data-value="phone">Viewport: phone</button>'
      + '</div>'
      + '<div class="toolbar-row">'
      + data.hubs.map(function (hub) {
        return '<button class="tab-btn ' + (state.hubId === hub.id ? 'is-active' : '') + '" data-control="hub" data-value="' + hub.id + '">Hub: ' + hub.name + '</button>';
      }).join('')
      + '</div>'
      + '<div class="segmented" role="group" aria-label="Workspace">'
      + data.workspaceOptions.map(function (workspace) {
        return '<button class="segment-btn ' + (state.workspace === workspace ? 'is-active' : '') + '" data-control="workspace" data-value="' + workspace + '">Workspace: ' + workspace + '</button>';
      }).join('')
      + '</div>'
      + '<div class="toolbar-row">'
      + data.secondaryOptions.map(function (secondary) {
        return '<button class="secondary-btn ' + (state.secondary === secondary ? 'is-active' : '') + '" data-control="secondary" data-value="' + secondary + '">Secondary: ' + secondary + '</button>';
      }).join('')
      + '</div>'
      + '<div class="toolbar-row">'
      + data.modalOptions.map(function (modal) {
        return '<button class="secondary-btn ' + (state.modal === modal ? 'is-active' : '') + (modal === 'reset' ? ' warn' : '') + '" data-control="modal" data-value="' + modal + '">Modal: ' + modal + '</button>';
      }).join('')
      + '</div>'
      + '<div class="segmented" role="group" aria-label="Phone focus">'
      + '<button class="segment-btn ' + (state.phoneFocus === 'content' ? 'is-active' : '') + '" data-control="phone-focus" data-value="content">Phone focus: content</button>'
      + '<button class="segment-btn ' + (state.phoneFocus === 'sheet' ? 'is-active' : '') + '" data-control="phone-focus" data-value="sheet">Phone focus: sheet</button>'
      + '</div>'
      + '</div>'
      + renderVariableGrid()
      + '</div>';
  }

  function renderPrototypePage() {
    return ''
      + '<section class="hero">'
      + '<p class="eyebrow">Nearbytes UI prototype · executable mockup</p>'
      + '<h1>Shared shell prototype</h1>'
      + '<p>This page shows the same state rendered as desktop and as phone. The controls on the right change the shared state. The previews do not change independently.</p>'
      + '<nav class="prototype-nav"><a href="./index.html" aria-current="page">Prototype</a><a href="./state-machine.html">Machine view</a><a href="../index.html">UI specs</a></nav>'
      + '</section>'
      + '<div class="layout">'
      + '<div class="stack">'
      + renderReadingGuide()
      + '<section class="surface">'
      + '<span class="badge">Previews</span>'
      + '<h2>The two UIs</h2>'
      + '<p>The large canvas is the desktop UI. The narrow canvas is the phone UI. Both use the same state.</p>'
      + '<div class="mock-shells">'
      + '<article class="mock-shell-card"><div class="preview-heading"><div><strong>Desktop UI</strong><p>Wide application shell</p></div></div><nb-shell-prototype id="desktop-shell"></nb-shell-prototype></article>'
      + '<article class="mock-shell-card"><div class="preview-heading"><div><strong>Phone UI</strong><p>Narrow application shell</p></div></div><nb-shell-prototype id="phone-shell"></nb-shell-prototype></article>'
      + '</div>'
      + '</section>'
      + '<section class="surface">'
      + '<span class="badge">Transitions</span>'
      + '<h2>State changes</h2>'
      + '<div class="transitions">' + renderTransitions() + '</div>'
      + '</section>'
      + '</div>'
      + '<div class="stack">'
      + renderControls()
      + '<section class="surface">'
      + '<span class="badge">State object</span>'
      + '<h2>Current values</h2>'
      + '<p>This is the state used by the previews and the machine view.</p>'
      + '<div class="code-block"><pre>' + stateJson() + '</pre></div>'
      + '</section>'
      + '</div>'
      + '</div>';
  }

  function renderMachinePage() {
    return ''
      + '<section class="hero">'
      + '<p class="eyebrow">Nearbytes UI prototype · machine inspector</p>'
      + '<h1>Machine view</h1>'
      + '<p>This page shows the same prototype state as variables, allowed values, and transitions.</p>'
      + '<nav class="prototype-nav"><a href="./index.html">Prototype</a><a href="./state-machine.html" aria-current="page">Machine view</a><a href="../index.html">UI specs</a></nav>'
      + '</section>'
      + '<div class="layout">'
      + '<div class="stack">'
      + '<section class="surface">'
      + '<span class="badge">Machine</span>'
      + '<h2>Active machine</h2>'
      + '<nb-state-machine-view id="machine-view"></nb-state-machine-view>'
      + '</section>'
      + '<section class="surface">'
      + '<span class="badge">Variables</span>'
      + '<h2>Current values</h2>'
      + renderVariableGrid()
      + '<div class="code-block"><pre>' + stateJson() + '</pre></div>'
      + '</section>'
      + '<section class="surface">'
      + '<span class="badge">State table</span>'
      + '<h2>Variables and rules</h2>'
      + renderStateVariableTable()
      + '</section>'
      + '</div>'
      + '<div class="stack">'
      + renderControls()
      + '<section class="surface">'
      + '<span class="badge">Transitions</span>'
      + '<h2>Allowed state changes</h2>'
      + '<div class="transitions">' + renderTransitions() + '</div>'
      + '</section>'
      + '<section class="surface">'
      + '<span class="badge">Invalid combinations</span>'
      + '<h2>Rejected states</h2>'
      + renderInvalidCombinationTable()
      + '</section>'
      + '</div>'
      + '</div>';
  }

  function mountPage() {
    const root = document.getElementById('app');
    const page = document.body.dataset.page || 'prototype';

    if (!root) {
      return;
    }

    root.innerHTML = page === 'machine' ? renderMachinePage() : renderPrototypePage();

    const desktopShell = document.getElementById('desktop-shell');
    if (desktopShell) {
      desktopShell.model = getModel('desktop');
    }

    const phoneShell = document.getElementById('phone-shell');
    if (phoneShell) {
      phoneShell.model = getModel('phone');
    }

    const machineView = document.getElementById('machine-view');
    if (machineView) {
      machineView.model = getModel(state.viewport);
    }

    bindControls(root);
  }

  function bindControls(root) {
    root.querySelectorAll('[data-control]').forEach(function (element) {
      element.addEventListener('click', function () {
        const control = element.getAttribute('data-control');
        const value = element.getAttribute('data-value');

        if (!control || !value) {
          return;
        }

        if (control === 'viewport') {
          state.viewport = value;
        } else if (control === 'hub') {
          state.hubId = value;
          state.modal = 'none';
        } else if (control === 'workspace') {
          state.workspace = value;
        } else if (control === 'secondary') {
          state.secondary = value;
          if (value !== 'none') {
            state.modal = 'none';
          }
        } else if (control === 'modal') {
          state.modal = value;
        } else if (control === 'phone-focus') {
          state.phoneFocus = value;
        }

        mountPage();
      });
    });

    root.querySelectorAll('[data-action]').forEach(function (element) {
      element.addEventListener('click', function () {
        const action = element.getAttribute('data-action');
        const value = element.getAttribute('data-value');

        if (action === 'hub-cycle') {
          state.hubId = nextInList(data.hubs.map(function (hub) {
            return hub.id;
          }), state.hubId);
          state.modal = 'none';
        } else if (action === 'open-create') {
          state.modal = 'create';
        } else if (action === 'cycle-secondary') {
          state.secondary = nextInList(data.secondaryOptions, state.secondary);
          if (state.secondary !== 'none') {
            state.modal = 'none';
          }
        } else if (action === 'set-workspace' && value) {
          state.workspace = value;
        } else if (action === 'phone-focus' && value) {
          state.phoneFocus = value;
        } else if (action === 'close-modal') {
          state.modal = 'none';
        }

        mountPage();
      });
    });
  }

  window.addEventListener('DOMContentLoaded', mountPage);
})();