## Matrix for Nearbytes: do you need to rewrite the client?

Not necessarily. For a local-per-user instance model, you usually only need to implement a Matrix client using the Client-Server API or an existing Matrix SDK. The Client-Server API is specifically designed for clients to send messages, manage rooms, and sync events and history.

Official docs:
- Matrix Client-Server API: https://spec.matrix.org/latest/client-server-api/
- Matrix Application Service API: https://spec.matrix.org/latest/application-service-api/
- Matrix SDKs: https://matrix.org/sdks/

### Practical distinction
- If Nearbytes is a local app that sends and receives messages, joins rooms, uploads files, and syncs events, then a normal Matrix client is enough.
- If you want a server-side integration or homeserver-level bridge/service, then you are in Application Service territory, which is a different, server-side model.

### What this means for Nearbytes
Nearbytes can be a specialized client that speaks Matrix. You do not need to build a full Matrix messenger like Element. You only need to implement the subset of Matrix features that Nearbytes actually uses.

### Minimum features to implement
- Login / authentication
- Session and device management
- `/sync` for receiving events and updates
- Room management
- Sending and receiving messages
- Uploading and downloading attachments
- End-to-end encryption, if you need it

### Realistic implementation options
- Implement the Client-Server API directly
- Or start from an existing Matrix SDK, which is usually the more practical approach

### Conclusion
You do not just “swap two APIs,” but you also do not need to rewrite a full Matrix client from scratch. You only need to build the subset of Matrix client functionality that Nearbytes actually needs. For a model with one local instance per user, Matrix fits much better as a specialized client architecture than as a bot platform like Telegram or Slack.