# Platform Design Family

This family holds host-specific design notes that sit below shared architecture and migration plans.

Current near-term host line:

- browser host: shared web app with graceful capability fallbacks
- desktop host: Electron shell plus the current runtime behind the host bridge
- Capacitor host: shared web app with progressively added phone capabilities, starting with UI and LAN-facing surfaces

Platform documents must inherit the shared ownership rules from:

- `../architecture/host-contract-runtime-boundary-v1.md`
- `../architecture/browser-application-crypto-boundary-v1.md`

Platform documents may describe:

- how a host satisfies the shared host contract
- native and runtime composition for that host
- capability availability and lifecycle behavior
- the current shared-surface inventory baseline that hosts are required to preserve
- shell-specific integration details

Platform documents may not redefine:

- shared navigation or feature ownership
- browser-owned application crypto or projections
- the permanent host contract shape
- Phase 1 desktop parity or phone ship gates

Platform documents should never redefine shared application behavior. They should only describe how a given host satisfies the shared host contract.