# MEGA Key-Manager Failure And Recovery

This note documents the MEGA account failure we reproduced during E2E recovery work and the repair path now kept in the repository.

## Failure Summary

The visible browser symptom on `mega.nz` was:

```text
SecurityError: Your cryptographic keys have gone missing. It is not safe to use your account at this time. (#12)
```

The direct cause was the old destructive E2E reset flow deleting the MEGA `^!keys` attribute. `^!keys` is the account key-manager container used by official MEGA clients. If the official web client still remembers a positive key-manager generation locally and then finds `^!keys` missing on the account, it enters the fatal "keys have gone missing" path.

This is separate from the older Nearbytes-side serializer bug that could corrupt `^!keys` contents during share-key updates. That serializer bug affected normal write paths and was fixed in the adapter. The account-repair incident here came from the reset tooling deleting `^!keys` entirely.

## Current Repair Strategy

The repository now repairs affected accounts by rebuilding `^!keys` instead of deleting it.

Implementation:

- `scripts/e2e-mega-reset.mjs`
- `src/integrations/mega.ts`

The rebuild path reconstructs a minimal canonical MEGA key-manager container from surviving account material:

- `*keyring` for `prEd255` and `prCu255`
- login `privk` for the compact RSA private-key payload expected by key-manager tag `18`
- `*!authring` and `*!authCu255` when present
- current user handle for the identity tag

The rebuilt container keeps the required canonical tags and writes an updated generation so official MEGA clients can continue normally.

## Recovery Procedure

Prerequisites:

- build output must be available
- `.env.e2e` or equivalent environment must provide the target MEGA credentials
- use this only for dev/E2E accounts

Recommended command:

```bash
yarn e2e:mega-reset
```

What it does:

1. revokes outgoing shares between the configured E2E accounts
2. wipes Cloud Drive and clears Rubbish Bin
3. rebuilds `^!keys` from surviving key material instead of deleting it

If you need to invoke the logic directly from code, use:

- `rebuildMegaSecurityAttributeForE2e(...)` from `src/integrations/mega.ts`

## Verification Procedure

After repair, verify both the official client and Nearbytes behavior.

### 1. Browser login verification

Run the live Playwright browser parity check against each repaired account:

```bash
set -a && source ./.env.e2e && set +a
export NEARBYTES_E2E_MEGA_EMAIL="$NEARBYTES_E2E_MEGA_OWNER_EMAIL"
yarn playwright test e2e/mega-browser-login.spec.ts

export NEARBYTES_E2E_MEGA_EMAIL="$NEARBYTES_E2E_MEGA_RECIPIENT_EMAIL"
yarn playwright test e2e/mega-browser-login.spec.ts
```

Expected result:

- the account reaches MEGA Cloud Drive without the key-missing error

### 2. Nearbytes reconnect verification

Run the reconnect regression:

```bash
yarn vitest run src/integrations/__tests__/managedShares.test.ts -t 'reconnecting MEGA'
```

Expected result:

- the reconnect path passes
- incoming Nearbytes shares are auto-adopted correctly after reconnect

## When This Could Happen

The exact browser-breaking missing-`^!keys` failure should not happen during ordinary app usage now that the reset flow rebuilds `^!keys` rather than deleting it.

Historically there were two risks:

1. dev/E2E destructive reset deleted `^!keys`
2. an older adapter bug could overwrite the wrong record inside `^!keys`

Both identified causes are now addressed, but any future code that writes `^!keys` should still be treated as security-sensitive and covered by regression tests.

## Related Files

- `scripts/e2e-mega-reset.mjs`
- `src/integrations/mega.ts`
- `src/integrations/__tests__/megaAdapter.test.ts`
- `e2e/mega-browser-login.spec.ts`
- `docs/mega.md`