## iCloud / CloudKit sharing and change notifications

CloudKit can provide app-managed sharing and near-real-time change notifications, but only for data stored in your app’s iCloud container. It is not a general-purpose API for managing arbitrary iCloud Drive folders the way Dropbox can manage a user’s file tree.

Official docs:
- CloudKit overview: https://developer.apple.com/documentation/cloudkit
- CloudKit sharing guide: https://developer.apple.com/documentation/cloudkit/sharing-cloudkit-data-with-other-icloud-users
- Shared records: https://developer.apple.com/documentation/cloudkit/shared-records
- `UICloudSharingController`: https://developer.apple.com/documentation/uikit/uicloudsharingcontroller
- `CKShare`: https://developer.apple.com/documentation/cloudkit/ckshare
- `CKAcceptSharesOperation`: https://developer.apple.com/documentation/cloudkit/ckacceptsharesoperation
- Remote records / subscriptions: https://developer.apple.com/documentation/cloudkit/remote-records
- `CKDatabaseSubscription`: https://developer.apple.com/documentation/cloudkit/ckdatabasesubscription
- `CKFetchRecordZoneChangesOperation`: https://developer.apple.com/documentation/cloudkit/ckfetchrecordzonechangesoperation

### What CloudKit supports
- Store structured app data in your app’s iCloud container
- Share that app data with other iCloud users using `CKShare`
- Manage sharing UI inside your app with `UICloudSharingController`
- Accept incoming shares in your app with `CKAcceptSharesOperation`
- Subscribe to changes and receive push notifications when records change
- Fetch only the changed records using change tokens

### Sharing flow
1. Save your app data as CloudKit records, typically in a custom record zone.
2. Create a `CKShare` for the records or zone you want to share.
3. Present `UICloudSharingController` so the user can invite people and manage permissions.
4. When another user opens the share link, your app receives share metadata.
5. Run `CKAcceptSharesOperation` to accept the share.
6. Read the shared content from the shared database.

### Change notification model
CloudKit subscriptions are change triggers, not full data payloads. A subscription can notify your app when records are created, modified, or deleted. After receiving the notification, your app must fetch the changed zones or records and use server change tokens to limit results to only changes since the last fetch.

### Does it carry contents directly?
Not reliably as the notification mechanism itself. Push notifications indicate that something changed, but Apple says the system may omit data and coalesce notifications. Your app should treat notifications as a signal to fetch the changed records from CloudKit, not as the full content transport.

### What it is good for
- App-native sync across Apple devices
- Sharing your app’s data with other iCloud users
- In-app invite and accept-share flows
- Efficient change fetching after push notifications

### What it is not
- Not a general API for arbitrary iCloud Drive folder sharing
- Not a Dropbox-style file backend for the user’s whole cloud filesystem
- Not a guaranteed one-notification-per-change event stream
- Not a transport for arbitrary local folders outside your app’s iCloud data model

### Best fit
Use CloudKit if Nearbytes stores its own app data in iCloud and you want Apple-native sharing, acceptance, and sync. Do not treat CloudKit as a generic third-party file transport for arbitrary iCloud Drive locations.