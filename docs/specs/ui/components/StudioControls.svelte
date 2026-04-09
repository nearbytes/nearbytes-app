<script>
  export let data;
  export let state;
  export let uiState;
</script>

<aside class="studio-controls">
  <section class="control-group">
    <h3>Moodboard</h3>
    <div class="token-choices">
      {#each data.moodboards as item}
        <button class="token-btn" class:active={item.id === state.moodboardId} data-moodboard={item.id}>{item.name}</button>
      {/each}
    </div>
  </section>

  <section class="control-group">
    <h3>Palette tuning</h3>
    <div class="token-stack">
      <label class="token-row">
        <span>Accent</span>
        <input class="range-input" type="range" min="70" max="130" value={state.accentStrength} data-range="accentStrength">
      </label>
      <div class="token-choices">
        <button class="token-btn" class:active={state.radiusMode === 'crisp'} data-radius="crisp">Crisp</button>
        <button class="token-btn" class:active={state.radiusMode === 'soft'} data-radius="soft">Soft</button>
        <button class="token-btn" class:active={state.radiusMode === 'round'} data-radius="round">Round</button>
      </div>
    </div>
  </section>

  <section class="control-group">
    <h3>Shell state</h3>
    <div class="token-choices">
      <button class="seg-btn" class:active={uiState.workspace === 'files'} data-control="workspace" data-value="files">Files</button>
      <button class="seg-btn" class:active={uiState.workspace === 'chat'} data-control="workspace" data-value="chat">Chat</button>
      <button class="seg-btn" class:active={uiState.workspace === 'split'} data-control="workspace" data-value="split">Split</button>
    </div>
    <div class="token-choices">
      <button class="seg-btn" class:active={uiState.secondary === 'none'} data-control="secondary" data-value="none">Workspace</button>
      <button class="seg-btn" class:active={uiState.secondary === 'locations'} data-control="secondary" data-value="locations">Storage</button>
      <button class="seg-btn" class:active={uiState.secondary === 'flow'} data-control="secondary" data-value="flow">Flow</button>
      <button class="seg-btn" class:active={uiState.secondary === 'identities'} data-control="secondary" data-value="identities">Identities</button>
    </div>
    <div class="token-choices">
      <button class="seg-btn" class:active={uiState.storageMode === 'volume'} data-control="storageMode" data-value="volume">Hub storage</button>
      <button class="seg-btn" class:active={uiState.storageMode === 'global'} data-control="storageMode" data-value="global">Global storage</button>
    </div>
    <div class="token-choices">
      <button class="seg-btn" class:active={uiState.dialogSurface === 'none'} data-control="dialogSurface" data-value="none">No dialog</button>
      <button class="seg-btn" class:active={uiState.dialogSurface === 'share'} data-control="dialogSurface" data-value="share">Share</button>
      <button class="seg-btn" class:active={uiState.dialogSurface === 'join'} data-control="dialogSurface" data-value="join">Join</button>
      <button class="seg-btn" class:active={uiState.dialogSurface === 'create'} data-control="dialogSurface" data-value="create">Create</button>
      <button class="seg-btn" class:active={uiState.dialogSurface === 'identity'} data-control="dialogSurface" data-value="identity">Identity</button>
      <button class="seg-btn" class:active={uiState.dialogSurface === 'reset'} data-control="dialogSurface" data-value="reset">Reset</button>
    </div>
    <div class="token-choices">
      <button class="seg-btn" class:active={uiState.searchOpen} data-toggle="searchOpen">Search</button>
      <button class="seg-btn" class:active={uiState.timelineOpen} data-toggle="timelineOpen">Timeline</button>
      <button class="seg-btn" class:active={uiState.phoneMenuOpen} data-toggle="phoneMenuOpen">Phone menu</button>
      <button class="seg-btn" class:active={uiState.viewMode === 'details'} data-view="details">List</button>
      <button class="seg-btn" class:active={uiState.viewMode === 'icons'} data-view="icons">Tiles</button>
    </div>
  </section>
</aside>