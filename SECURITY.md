# Security Policy

## Reporting

If you discover a security issue in Nearbytes, do not open a public issue with exploit details.

Until a dedicated security process is established, report the issue privately to the maintainer address currently listed in [package.json](./package.json): `vincenzoml@gmail.com`.

Include:

- affected version or commit
- impact summary
- reproduction steps or proof of concept
- any suggested mitigation

## Scope

Security-sensitive areas in this repository include:

- event encryption and signing
- key handling and reference codecs
- local network discovery and transport
- desktop runtime authentication and signaling
- provider credential bootstrap flows

## Disclosure Expectations

- give maintainers time to reproduce and fix the issue before public disclosure
- prefer minimal distribution of proof-of-concept details until a fix ships
- when possible, propose a regression test with the report