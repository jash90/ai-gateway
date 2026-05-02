# Features

Feature-first folders. Each `<name>/` is a self-contained domain slice.

## Layout

```
features/<name>/
├── index.ts            # public surface — only what routes need
├── components/         # UI components (one per file, displayName set)
├── hooks/              # screen orchestration hooks (useXxxScreen, ...)
└── services/           # data layer wrappers around Orval-generated hooks
```

## Rules

1. **Routes are thin mounts.** A file in `src/routes/` should import from `@features/<name>` and not declare business logic.
2. **No cross-feature imports.** If `applications` needs something from `provider-keys`, lift it to `@shared/*` instead.
3. **Public surface = `index.ts` only.** Routes import `from '@features/applications'`, never `from '@features/applications/components/AppForm'`.
4. **Internals are internal.** `components/`, `hooks/`, `services/` are consumed within the feature folder; not re-exported by `index.ts`.
5. **Screen orchestration hooks live next to their screens** (see project memory: `useXxxScreen.ts` inside the screen folder, not in `hooks/`).

## Current features

| Feature | Sprint | Status |
|---|---|---|
| `auth` | Sprint 1 | Login / Register / VerifyEmail / ForgotPassword / ResetPassword |
| `applications` | Sprint 2 | List / Detail / Keys management |
| `provider-keys` | Sprint 2 | BYOK CRUD + test |
| `analytics` | Sprint 3 | Charts / Breakdowns / Timeseries / Events |
| `playground` | Sprint 2 | Existing — endpoint URLs migrated |
| `webhooks` | Sprint 4 | Existing — RHF+Zod refactor |
| `alerts` | Sprint 4 | Existing — RHF+Zod refactor |
| `admin` | Sprint 4 | Existing — multi-tenant view + JWT auth |
| `settings` | Sprint 1+2 | Existing — drop api-key, add provider-keys |
