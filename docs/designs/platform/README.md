# Platform Design Family

This family holds host-specific design notes that sit below shared architecture and migration plans.

Current near-term host line:

- browser host: shared web app with graceful capability fallbacks
- desktop host: Electron shell plus the current runtime behind the host bridge
- Capacitor host: shared web app with progressively added mobile capabilities, starting with UI and LAN-facing surfaces

Platform documents should never redefine shared application behavior. They should only describe how a given host satisfies the shared host contract.