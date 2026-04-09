# Spec Migration

- [x] Replace `docs/specs/ui` in place with a Svelte spec app that reproduces the previous HTML spec exactly, keeps the same directory and page URLs, and expresses the spec chrome as Svelte components. Commit: `df85283`
- [ ] Make the shipped app import and use the Svelte spec components from `docs/specs/ui` as the canonical design source. Commit:
	Runtime shell imports now resolve from `docs/specs/ui/components` and `docs/specs/ui/workspaceChrome.ts`; remaining app-owned design surfaces still need the same migration.
