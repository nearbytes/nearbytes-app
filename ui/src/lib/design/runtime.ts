import type { DesignSystemRuntime } from '../../../../docs/specs/ui/system/runtime.js';
import {
  acceptManagedShare,
  acceptIncomingProviderContactInvite,
  attachManagedShare,
  chooseDirectoryPath,
  configureProviderSetup,
  connectProviderAccount,
  createManagedShare,
  consolidateRoot,
  disconnectProviderAccount,
  discoverSources,
  getAppConfig,
  getManagedShareState,
  getRootsConfig,
  getStorageLocationRepairReport,
  getTimeline,
  hasDesktopDirectoryPicker,
  installProviderHelper,
  inviteManagedShare,
  listChat,
  listIncomingManagedShares,
  listIncomingProviderContactInvites,
  listLocalNetworkPeers,
  listManagedShares,
  listProviderAccounts,
  openPathInFileManager,
  openRootInFileManager,
  publishIdentity,
  readDesktopRuntimeLogs,
  removeManagedShare,
  repairStorageLocation,
  sendChatMessage,
  syncLocalNetworkPeer,
  updateProviderEnabled,
  updateRootsConfig,
  watchSources,
  watchVolume,
} from '../api.js';
import { readMirrorLocalNetworkPeers } from '../mirror/browserMirror.js';
import { exportSourceReferenceBundleFromDrag } from '../nearbytesReferenceTransfer.js';

export function createAppDesignRuntime(): DesignSystemRuntime {
  return {
    chat: {
      async listChat(auth) {
        return listChat(auth);
      },
      async publishIdentity(auth, identitySecret, profile) {
        await publishIdentity(auth, identitySecret, profile);
      },
      async sendChatMessage(auth, identitySecret, input) {
        await sendChatMessage(auth, identitySecret, input);
      },
      async exportSourceReferenceBundleFromDrag(auth, payloadText) {
        return exportSourceReferenceBundleFromDrag(auth, payloadText);
      },
    },
    storage: {
      acceptManagedShare,
      acceptIncomingProviderContactInvite,
      attachManagedShare,
      chooseDirectoryPath,
      configureProviderSetup,
      connectProviderAccount,
      createManagedShare,
      consolidateRoot,
      disconnectProviderAccount,
      discoverSources,
      getAppConfig,
      readDesktopRuntimeLogs,
      getManagedShareState,
      getStorageLocationRepairReport,
      getRootsConfig,
      hasDesktopDirectoryPicker,
      installProviderHelper,
      inviteManagedShare,
      listLocalNetworkPeers,
      listIncomingManagedShares,
      listIncomingProviderContactInvites,
      listManagedShares,
      listProviderAccounts,
      syncLocalNetworkPeer,
      updateProviderEnabled,
      openPathInFileManager,
      openRootInFileManager,
      readMirrorLocalNetworkPeers,
      repairStorageLocation,
      removeManagedShare,
      watchSources,
      updateRootsConfig,
    },
    flow: {
      getRootsConfig,
      watchSources,
      watchVolume,
      getTimeline,
    },
  };
}
