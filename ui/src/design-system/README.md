Nearbytes shared design system lives here.

Rules:
- Edit tokens, shared state helpers, and reusable UI surfaces in `ui/src/design-system`.
- The production app imports these files directly.
- Design mode in `ui/src/main.ts` also applies the same shared tokens and global styles.

Intent:
- Designers and engineers work against one authoritative component set.
- App styling should not be added in parallel under `docs/specs/ui/components`.
