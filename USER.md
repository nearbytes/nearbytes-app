# Human Tasks For V1.0

This file captures the work that cannot be truthfully completed by an automated repo pass alone.

## Release Blockers Requiring Human Validation

### 1. Multi-host LAN verification

Run real two-machine validation after the WebRTC transport switch on at least:

- macOS to macOS
- macOS to Windows
- macOS to Linux or Linux to Linux

Confirm:

- DNS-SD discovery works without manual repair
- multicast fallback works when DNS-SD is unavailable or partial
- receiver-driven sync does not re-request already-present objects
- stale peers disappear promptly after signal-path failure or disconnect
- no bulk transfer depends on the local signaling server beyond signaling itself

Record the exact machines, commits, and outcomes in [WIP.md](./WIP.md).

### 2. Real iPhone runtime validation

Verify on physical iPhone hardware, not just simulator or desktop-proxy development:

- independent peer discovery and sync without a desktop-hosted proxy acting as the practical backend
- durable local opaque-object retention across suspend, resume, force-quit, and reopen
- join, identity, and other dialog-heavy flows at iPhone sizes without overflow or trapped completion states
- networking behavior under the explicit ATS exceptions now in the iOS shell

If any of this still depends on a desktop companion path, Phase 1 is not complete.

### 3. MEGA adapter failure triage

The workspace still shows a failing `mega-adapter-vitest` task. A human needs to rerun it, capture the failing output, and decide whether the failure is:

- a real regression
- an environment issue
- a live-provider dependency mismatch

Do not cut a v1.0 release while that status is ambiguous.

### 4. Release authority and distribution decisions

Before tagging `v1.0.0`, decide and document:

- supported platforms for the first public release
- whether iPhone is included in the release claim or remains experimental
- whether GitHub Releases alone are the distribution channel for desktop binaries
- who owns security triage and release signoff

## Repo Tasks Already Unblocked For Humans

### 5. Open-source packaging review

This repository now has baseline project files for public release:

- [LICENSE](./LICENSE)
- [CONTRIBUTING.md](./CONTRIBUTING.md)
- [SECURITY.md](./SECURITY.md)
- [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)

Humans should still review the text for governance and contact details before public announcement.

### 6. Final docs pass

Read [README.md](./README.md), [WIP.md](./WIP.md), and the active design docs together and remove any claim that implies completed phone parity or completed migration if those claims are not yet true.

### 7. Tagging checklist

Only tag `v1.0.0` after all of the following are true:

- release blockers above are closed and recorded
- working tree is clean
- focused regressions and broad validation pass
- release artifacts build on the claimed platforms
- the public release notes state known limitations plainly