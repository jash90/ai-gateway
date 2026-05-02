# AGENTS.md — Task-Oriented Playbook

> Companion to `CLAUDE.md` (universal conventions). This file is task-oriented:
> "when you need to do X, follow this procedure". Drop into any project's
> `docs/standards/` folder. AI agents (Claude Code, Cursor, Copilot, custom
> SDK agents) read this alongside `CLAUDE.md` at session start.

---

## How This Doc is Organized

Sections group by lifecycle stage:
- **Adopting this doc** — first-time onboarding into an existing project
- **Starting new work** — planning, scoping, branch setup
- **Feature development** — playbooks for common tasks
- **Modifying existing code** — refactors, bug fixes, migrations
- **Finishing work** — PR, review, merge, deploy
- **Troubleshooting** — when things go wrong

Each playbook follows the same shape:
```
Goal: <one line>
Trigger: <when to use this playbook>
Steps: <ordered checklist>
Verification: <how to prove it works>
Common pitfalls: <what breaks most often>
```

---

## A. Adopting This Doc into a New Project

### A.1 First-time Audit (run once)

**Goal:** Map the project's actual conventions against this doc, identify
drift, and document overrides.

**Steps:**
1. Read the project root. Look for:
   - `README.md` (tech stack, run commands)
   - `package.json` scripts (test, build, lint commands)
   - `.github/workflows/*` (CI gates)
   - Existing `CLAUDE.md` / `AGENTS.md` / `.claude/rules/` (prior conventions)
2. Inventory the actual stack:
   - Runtime (Node version, bundler)
   - Package manager (look at lockfile: `bun.lockb` / `pnpm-lock.yaml` /
     `package-lock.json` / `yarn.lock`)
   - Framework (React, Vue, Svelte; backend framework)
   - Database (Prisma schema? SQL migrations? NoSQL?)
   - Styling (Tailwind? CSS-in-JS? StyleSheet?)
3. Map to CLAUDE.md sections. Where the project matches, great. Where it
   doesn't, write an `## Overrides` section at the top of project-root
   CLAUDE.md explaining the deviation.
4. **NEVER silently refactor** to match the doc. Document drift, then ask
   user whether to migrate.

**Verification:**
- Project-root `CLAUDE.md` exists and either imports
  `docs/standards/CLAUDE.md` or lists deviations.
- Running `type-check`, `lint`, `test` locally passes before any other work.

---

## B. Starting New Work

### B.1 Scoping a Task

**Goal:** Turn a user request into a concrete plan with verifiable steps.

**Trigger:** User sends a prompt that requires more than 3 file edits OR
touches multiple layers (DB + API + UI).

**Steps:**
1. **Restate the goal in one sentence.** If you can't, ask for clarification.
2. **Identify the layers affected.** DB schema? API endpoint? Admin UI?
   Mobile UI? Shared types?
3. **Write a plan with 3-8 bullet points.** Each bullet is one layer or one
   file-group. Post the plan before coding.
4. **Ask explicitly if the plan is OK** when the task involves:
   - New DB columns or migrations
   - New public API endpoints
   - Changes to shared types
   - Third-party library adoption
   - Anything that takes > 15 minutes to undo
5. **Proceed only after ack** (or if task is clearly low-risk like
   "change a label").

**Common pitfalls:**
- Starting to code without a plan → large diff, hard to review.
- Plan without ack on DB changes → migrations land that user didn't want.
- Silent scope creep → bundle unrelated fixes into one PR.

### B.2 Branch & Worktree Setup

**Goal:** Isolate work from main so it can be reviewed and reverted cleanly.

**Steps:**
1. **Check current branch.** `git status` — if on `main` / `master`, STOP.
   Never code on main without explicit user consent.
2. **Create a feature branch.** `git checkout -b feat/<short-name>` or
   `fix/<issue>`.
3. **For long-running work (multiple sessions):** use a git worktree so you
   don't disrupt the user's active branch:
   ```bash
   git worktree add ../project-worktrees/<branch> -b <branch>
   cd ../project-worktrees/<branch>
   ```
4. **Verify clean baseline.** Run tests before first commit. If tests fail
   on `main`, flag to user — don't start work on a broken baseline.

---

## C. Feature Development Playbooks

### C.1 Adding a Database Column

**Goal:** Add a new field to a table, thread it through every layer.

**Steps:**
1. **Edit `prisma/schema.prisma`.** Declare the column with correct type,
   default, nullability.
2. **Create migration:**
   ```bash
   npx prisma migrate dev --name add_<table>_<column>
   ```
   If this fails with "P3014 permission denied", grant CREATEDB to the
   dev user:
   ```bash
   psql ... -c "ALTER ROLE <user> CREATEDB;"
   ```
   If interactive-mode errors stop you, hand-create a migration file with
   idempotent SQL:
   ```sql
   ALTER TABLE "TableName" ADD COLUMN IF NOT EXISTS "columnName" TEXT;
   ```
   Then `npx prisma migrate deploy`.
3. **Regenerate Prisma client.** `npx prisma generate`.
4. **Update shared types** in `libs/shared/types/` — the TypeScript
   interface for the model.
5. **Update Zod schemas** in `libs/shared/validation/` — add to both
   Create and Update variants.
6. **Update API DTOs** (NestJS) or equivalent request/response shapes.
7. **Update any hand-written frontend interfaces.** If using Orval, run
   `bun generate:api` to refresh generated types.
8. **Seed / backfill** if the column needs initial values for existing rows.
9. **Update tests** — factory functions, fixtures.

**Verification:**
- `bunx tsc --noEmit` passes across all projects (api, admin, mobile,
  shared libs).
- Migration applies cleanly to a fresh DB: `prisma migrate reset --force`.
- Hit the API endpoint, verify the new field in response.

**Common pitfalls:**
- Forgetting to update the `.strict()` Zod schema → API silently drops the
  new field from requests.
- Migration uses natural timestamp (`2026-04-18_...`) instead of synthetic
  (`20260418140000_...`) → breaks deploy ordering.
- `prisma db push` instead of migrate → no migration file, CI/prod can't
  catch up. **Never do this for shared environments.**

### C.2 Adding a REST Endpoint

**Goal:** Expose a new URL path with proper auth, validation, logging.

**Steps:**
1. **Design the contract first:**
   - URL: `/resource/:id/subresource` (plural resources)
   - Method: `GET` / `POST` / `PATCH` / `DELETE`
   - Auth: public / user / admin / feature-gated
   - Request shape: path params + query + body
   - Response shape: success + error codes
2. **Write the Zod schema** for request body in `libs/shared/validation/`
   (strict, standalone — not `.partial()` of create schema).
3. **Create the DTO** in `apps/api/src/modules/<domain>/dto/<name>.dto.ts`
   using `createZodDto(Schema)` from `nestjs-zod`.
4. **Add service method** in `<domain>.service.ts`. Platform-agnostic,
   no HTTP concerns (no throwing `HttpException` from service — let the
   controller translate).
5. **Add controller method** with decorators:
   - `@Get('path')` / `@Post('path')` etc.
   - `@ApiOperation({ summary: 'Descriptive summary' })`
   - `@ApiResponse({ status: 200, description: '...' })` for each status
   - `@Throttle({ ... })` on sensitive routes
   - `@Roles(...)` if role-gated
6. **Handle errors at controller boundary:**
   - Map service exceptions to `HttpException` subclasses.
   - Always include a `code` field (machine-readable) + `message` (in the project's primary locale).
7. **Write a controller/service spec** — at least happy path + one error case.

**Verification:**
- Swagger UI at `/docs` shows the new endpoint.
- `curl` hits it with expected success + 400 + 401 + 403 cases.
- Integration test passes.

**Common pitfalls:**
- Putting business logic in the controller → can't reuse from cron jobs or
  other entry points.
- Route ordering: `/:id` defined before `/stats` → `/stats` hits the
  parameterized route with `id="stats"`.
- Missing `@Public()` on a signup/login endpoint → user can't register.

### C.3 Adding a Frontend Feature (web / admin)

**Goal:** Ship a new page, form, or widget using the feature-first pattern.

**Steps:**
1. **Create the feature folder:**
   ```
   apps/<app>/features/<name>/
   ├── index.ts              # barrel
   ├── ui/
   │   └── <Name>Page.tsx    # smart container
   └── hooks/                # if needed
   ```
2. **Use shared UI primitives ONLY.** Import from `@shared/ui/*` — never
   from external UI libraries directly in feature code. If a component
   doesn't exist or lacks a needed variant, create/extend it in
   `@shared/ui/` first (see playbook C.8). Do not inline missing
   components with raw `<div>` + Tailwind.
3. **Data fetching via TanStack Query.** Use `apiQueryOptions(endpoint)`
   from `@shared/api/client` for reads. Use `useApiMutation` for writes
   — don't call raw `apiMutate` in components.
4. **Register the route.** Create a file in `app/routes/` following the
   framework's convention (TanStack Router flat files, Expo Router, Next
   App Router).
5. **Add to navigation.** Update sidebar / bottom nav / header.
6. **Add to i18n.** Every user-facing string goes through `t('key')`, keys
   added to all locale JSONs.

**Verification:**
- Navigate to the route in the browser — page renders.
- Data loads (spinner → content → empty state).
- Forms submit successfully and invalidate queries.
- Type check + lint clean.

**Common pitfalls:**
- Using template-literal router links (`to={\`/users/\${id}\`}`) →
  compiles but breaks at runtime on missing routes. Use typed `params`.
- Fetching in `useEffect` → duplicates TanStack Query. Use query hooks.
- Hardcoding English strings → production shows English to Polish users.

### C.4 Adding a Mobile Screen

**Goal:** Ship a new screen in the Expo app using feature-first pattern.

**Steps:**
1. **Create feature folder:**
   ```
   apps/mobile/src/features/<name>/
   ├── index.ts
   ├── screens/<Name>Screen.tsx
   ├── hooks/use<Name>.ts
   └── services/<name>.service.ts
   ```
2. **Service → Hook → Screen** layering (D — Dependency Inversion):
   - Service: platform-agnostic, wraps API calls with `createCrudService`
     or hand-written methods.
   - Hook: orchestrates service + stores + platform callbacks (`onAlert`,
     `onDeleteRequest`).
   - Screen: renders UI, hooks into `useScreenTracking('Name')` for
     analytics.
3. **Styling:** `className` only (Uniwind). No `StyleSheet.create`.
4. **Use shared UI components ONLY.** Import from `@shared/ui/*` — never
   use raw `<View>` + Tailwind to build reusable widgets. If a component
   is missing or needs a variant, create/extend it in `@shared/ui/`
   first (see playbook C.8).
5. **Register route** in `src/app/` via Expo Router (file-based).
6. **i18n** — every string via `t('key')`.
7. **Error handling:** `showApiError` for API errors, `Alert.alert` for
   local validation / clinical warnings.

**Verification:**
- `bunx expo start --ios` loads the screen without errors.
- Pull-to-refresh works (if applicable).
- Error states (network down, 500) show proper localized message.
- Screen shows up in PostHog as a screen event.

**Common pitfalls:**
- `useEffect` for data fetching on a mobile screen → doesn't refetch on tab
  focus. Use `useFocusEffect` wrapping the hook's `fetchData`.
- Two nested modals with `presentationStyle="pageSheet"` → inner modal
  doesn't render. Inner must be fullscreen.
- Missing `SafeAreaProvider` inside `Modal` → content goes under notch.

### C.5 Integrating a Payment Provider

**Goal:** Add a new payment gateway while keeping existing providers working.

**Steps:**
1. **Model the provider in the schema.** Add to `PaymentProvider` enum in
   Prisma, add provider-specific fields to `Subscription` and
   `PaymentHistory` (`<provider>SessionId`, `<provider>OrderId`).
2. **Create a service** `apps/api/src/modules/payments/<provider>.service.ts`
   with:
   - `createTransaction(userId, planSlug)` — registers with provider API,
     returns redirect URL.
   - `handleNotification(body, sig)` — webhook handler. Verify signature,
     idempotent on repeat.
   - `verifyTransaction(...)` — call provider's verify API before
     activating subscription.
3. **Route payments based on plan currency / country.** E.g., PLN → P24,
   EUR/GBP/USD → Stripe. Put the routing logic in the controller, not the
   provider services.
4. **Add webhook endpoint** in `payments.controller.ts`. Always `@Public()`
   (no auth header from provider). Verify signature inside the service.
5. **Update the subscription activation transaction** to be idempotent on
   provider-specific session IDs.
6. **Env vars:** add to `.env.example` with documentation. Refuse to start
   if the service is enabled but credentials missing.

**Verification:**
- End-to-end test: register → redirect → mock webhook → verify →
  subscription ACTIVE in DB.
- Replay the webhook twice — idempotent, doesn't create duplicate
  subscriptions.
- Wrong signature rejected with 400.

**Common pitfalls:**
- Trusting the webhook payload without verifying — lets attackers grant
  themselves subscriptions.
- Activating subscription on webhook receipt without calling the provider's
  verify endpoint — webhook is async-notification, not payment confirmation.
- Hardcoding provider URL — should be env-driven (sandbox vs production).

### C.7 Adding a Form (React Hook Form + Zod)

**Goal:** Ship a type-safe form that validates at boundary + surfaces localized
errors + works smoothly with the mobile keyboard.

**Steps:**
1. **Design the schema first** in `libs/shared/validation/` (if reused by
   API) or `features/<name>/schemas/<name>-form.ts`.
   - Use `z.object({...}).strict()`.
   - Localized error messages inline: `z.string().email('Invalid email address')`.
   - Export `type FooInput = z.input<typeof Schema>` and
     `type FooOutput = z.output<typeof Schema>`.
2. **Create the form component** with `useForm<FooInput>`:
   ```ts
   const { control, handleSubmit, formState: { errors, isSubmitting } } =
     useForm<FooInput>({
       resolver: zodResolver(FooSchema),
       defaultValues: { ... },
       mode: 'onBlur',
     });
   ```
3. **Use `ControlledInput` / `Controller`** for every field — never raw
   `{...register('field')}` in this codebase (RHF's uncontrolled mode
   doesn't play well with Uniwind/Shadcn inputs that expect `value`).
4. **Submit handler** calls the mutation. Handle errors via
   `showApiError` (mobile) / toast (web). Invalidate TanStack Query on
   success.
5. **Pre-submit warnings** (soft, non-blocking) live in a separate
   `checkFormWarnings(values): string | null` function — call it from
   the submit handler, show `Alert.alert` confirm before mutation.
6. **Mobile only:** wrap scrollable form content in
   `KeyboardAwareScrollView` from `react-native-keyboard-controller` so
   the focused input is always visible above the keyboard.
7. **Mobile only:** if the form has > 3 inputs, add `<KeyboardToolbar />`
   for Previous/Next navigation.
8. **Tab order / return key:** set `returnKeyType="next"` on all inputs
   except the last (`returnKeyType="done"`). Chain via `onSubmitEditing`
   to focus the next field.

**Verification:**
- Empty form → submit shows all required field errors.
- Invalid email → onBlur shows error, onChange clears it.
- Network error on submit → shows localized error (not raw "Network request failed").
- Mobile: keyboard doesn't cover the submit button or the focused field.
- Mobile: tapping outside the form dismisses the keyboard (`keyboardShouldPersistTaps="handled"` or outer `Pressable onPress={Keyboard.dismiss}`).
- Type check: `FooInput` matches RHF types, submit handler receives `FooOutput`.

**Common pitfalls:**
- Using `.partial()` of create schema as update schema — strips required
  fields silently. Write a standalone Update schema.
- Storing form values in a Zustand store — RHF already manages state.
- Calling `setValue` in `useEffect` triggered by `watch()` — creates
  feedback loops. Compute derived values in render or use `useWatch` with
  specific `name`.
- Forgetting to pass `control` to `<Controller>` — component silently
  shows empty value with no error.
- Mobile: using RN's built-in `KeyboardAvoidingView` instead of
  `react-native-keyboard-controller`'s — laggy animations, platform bugs.

---

### C.6 Adding a Multi-Locale Feature

**Goal:** New feature available in all supported languages.

**Steps:**
1. **Write the feature first in the primary locale** (e.g., Polish). Use
   literal strings while developing.
2. **Extract to i18n:**
   - For every user-facing string: pick a key (`feature.descriptiveName`).
   - Add to primary locale JSON.
   - Add to all other locale JSONs (stub translations if the copywriter
     hasn't provided yet — mark with `[TR]` prefix for visibility).
   - Replace literal with `t('key')`.
3. **Handle plurals** with i18next plural suffixes for languages that need
   them (Polish: `_one`, `_few`, `_many`, `_other`).
4. **Handle interpolation** for dynamic values:
   ```json
   "subscription.price": "{{price}} {{currency}}/mo."
   ```
5. **For API errors:** ensure the backend sends a `code`, and the frontend
   error mapper has a case for it:
   ```ts
   case 'PATIENT_NOT_FOUND': return t('errors.patientNotFound');
   ```

**Verification:**
- Switch device locale → UI switches. All strings still legible.
- Missing-key warnings in dev console resolve to zero.
- Grep for literal Polish/English strings in .tsx files — should only find
  intentional ones (placeholder `example.com` emails, etc.).

### C.8 Adding a Shared UI Component or Variant

**Goal:** Create a new reusable component or extend an existing one in
`@shared/ui/` so that every feature can use a consistent, design-token-
based UI primitive.

**Trigger:** You need a UI element that doesn't exist in `@shared/ui/`,
or an existing component lacks a variant required by a feature.

**Steps:**
1. **Check if it already exists.** Search `@shared/ui/` for a component
   that does what you need. Check existing variants (CVA) before
   creating something new.
2. **If it exists but lacks a variant:**
   - Add the new variant to the component's CVA config.
   - Export the new variant type.
   - Document the variant in the component file's comments.
   - Do NOT create a parallel component.
3. **If it doesn't exist:**
   - Create `<Component>.tsx` in `@shared/ui/`.
   - Wrap the external primitive (Shadcn, Radix, RN element) with a
     consistent API: `className` support, CVA variants, design tokens
     only.
   - Export from `@shared/ui/index.ts`.
   - Follow the existing component pattern in the folder (props
     interface, `React.memo`, `displayName`).
4. **Test it in the feature that needed it.** Verify it renders correctly
   on both web and mobile (if applicable).
5. **Ensure the component is generic** — no feature-specific logic,
   domain types, or hardcoded strings. It should be usable by any
   feature.

**Verification:**
- Component renders in isolation with all variants.
- No external UI library imports in feature code — only `@shared/ui/*`.
- Design tokens used exclusively (no magic colors, spacing, or
  typography values).
- `className` prop works for one-off overrides.

**Common pitfalls:**
- Creating a feature-specific component in `@shared/ui/` — shared
  components must be domain-agnostic.
- Hardcoding styles instead of using CVA variants — makes the component
  rigid and hard to extend.
- Forgetting to export from the barrel `index.ts` — component exists
  but nobody can import it.
- Duplicating an existing component with a slightly different name
  instead of adding a variant.

---

## D. Modifying Existing Code

### D.1 Refactoring

**Trigger:** User says "clean this up", "simplify", "refactor".

**Steps:**
1. **Read the code and the tests.** Understand invariants before changing.
2. **Write down the contract** you're preserving. What does it do
   externally?
3. **Make one change at a time.** Don't bundle rename + extract + simplify.
4. **Run tests after each change.** Don't accumulate 5 refactors and debug
   which one broke.
5. **Update comments, not just code.** Stale comments are worse than no
   comments.
6. **Remove dead code.** If the refactor makes something unused, delete it
   — don't leave it for "someone else".

**Common pitfalls:**
- Refactoring and adding features in the same commit.
- "Improving" code style in files you didn't need to touch — scope creep.
- Changing public API signatures without checking all call sites.

### D.2 Bug Fixing

**Trigger:** User reports a bug; ask for reproducer if not provided.

**Steps:**
1. **Reproduce locally first.** If you can't reproduce, the fix is a guess.
2. **Write a failing test** that exercises the bug. This is the
   "regression test".
3. **Find root cause.** Don't patch symptoms (e.g., adding null checks
   instead of fixing why `null` appeared).
4. **Fix the root cause.** Keep the diff minimal.
5. **Verify the test now passes and unrelated tests still pass.**
6. **Consider if the bug pattern exists elsewhere.** If it's a class of
   bug, flag it — don't silently fix only the reported instance.

**Common pitfalls:**
- Adding `?.` / `|| ''` everywhere → hides why data is missing.
- Fixing one call site while an identical bug lurks elsewhere.
- Closing the ticket without a regression test.

### D.3 Updating a Library

**Trigger:** Dependabot PR, CVE, major version release.

**Steps:**
1. **Read the changelog.** Don't blindly update majors.
2. **Run tests locally after updating.** Most incompatibilities surface
   immediately.
3. **For major updates:** create a dedicated branch, budget a day for
   follow-on fixes.
4. **Update the lockfile deterministically** — use the project's package
   manager, don't mix (`bun install`, not `npm install` in a bun project).
5. **Check peer dependency warnings** — bump them too if needed.

---

## E. Finishing Work

### E.1 Pre-PR Checklist

Before creating a PR:
- [ ] All relevant tests pass locally.
- [ ] Type check passes: `bunx tsc --noEmit -p <tsconfig>` for each project.
- [ ] Lint passes: `bunx nx run-many --target=lint --all`.
- [ ] Schema drift check (if touched `prisma/schema.prisma`).
- [ ] Migrations idempotent (if any).
- [ ] No commented-out code in the diff.
- [ ] No `console.log` / `print` / `TODO` left behind.
- [ ] All user-facing strings use `t()`.
- [ ] New env vars added to `.env.example`.
- [ ] Commit messages follow Conventional Commits.

### E.2 Creating the PR

**Steps:**
1. **Push the branch:** `git push -u origin <branch>`.
2. **Create PR via gh CLI:**
   ```bash
   gh pr create --title "feat(scope): short description" --body "$(cat <<'EOF'
   ## Summary
   - bullet 1
   - bullet 2

   ## Test plan
   - [ ] Manual test 1
   - [ ] Manual test 2
   EOF
   )"
   ```
3. **PR title ≤ 70 chars.** Details in body.
4. **Test plan is a real checklist**, not a list of features.
5. **Link related issues** (`Closes #123`).

### E.3 Responding to Review

- **Fix, don't argue.** If reviewer is confused, the code is unclear — fix
  the code (or comment explaining the non-obvious).
- **Small commits for review rounds.** Don't rewrite the whole PR; stack
  follow-up commits, squash at merge.
- **Respond inline** on the specific comment thread. "Fixed in <sha>" >
  generic "Updated".

---

## F. Troubleshooting Playbooks

### F.1 "Tests Pass Locally, Fail in CI"

Likely causes:
1. **Uncommitted generated files** — CI runs a clean checkout.
2. **Timezone** — local is Europe/Warsaw, CI is UTC. Grep for `new Date()`.
3. **Random data** — tests depending on `Math.random()` or `Date.now()`.
4. **DB state** — local DB has data from earlier runs; CI starts fresh.
5. **Node version mismatch** — `.nvmrc` / `engines` field vs CI image.

### F.2 "Migration Stuck on Railway / Production"

Symptoms: `prisma migrate deploy` fails with P3009 (failed migration
recorded), all subsequent deploys fail.

Resolution:
1. Grab `DATABASE_PUBLIC_URL` from Railway vars.
2. From local, with that URL:
   ```bash
   DATABASE_URL=<url> bunx prisma migrate resolve --applied <migration_name>
   ```
3. Or connect to Postgres and delete the failed row:
   ```sql
   DELETE FROM "_prisma_migrations" WHERE migration_name = '<name>' AND finished_at IS NULL;
   ```
4. Push again. If the migration was idempotent, it re-runs safely; if not,
   you need to fix the SQL first.

Do NOT use `railway run bunx prisma migrate resolve` — DATABASE_URL there
points at internal hostname, unreachable from laptop.

### F.3 "Frontend Shows 'Failed to resolve import'"

Usually a virtual module from the framework's Vite plugin not registered
in the client environment. Common with TanStack Start + custom setups.

Fix pattern: add a stub plugin in `vite.config.ts` that returns an empty
module for the missing virtual module in the client environment. The
runtime path guarded by `process.env.SSR_ONLY_VAR` never executes
client-side, so the stub is dead code.

See `apps/admin/vite.config.mts` in this repo for a working example.

### F.4 "Mobile App Not Picking Up Env Changes"

- **Release builds bake env at build time** — must rebuild to change.
- **Dev builds read env via Metro** — restart Metro with `--clear` flag.
- **Env var must be prefixed `EXPO_PUBLIC_`** to be exposed to JS bundle.

### F.5 "React Hydration Mismatch / Form Submits as GET"

Symptom: login form submits `GET /login?email=...&password=...`
with credentials in URL.

Cause: React never hydrated. Browser fell back to native HTML form
submission (default GET method).

Debug:
1. Check browser console for JS errors on page load.
2. In devtools, check that form element has `__reactProps` keys — if
   empty, hydration didn't reach the form.
3. Common cause: SSR imports server-only module (e.g.,
   `react-dom/server`) that has no default export in browser bundle →
   SyntaxError at module instantiation → client entry dies.
4. Fix: stub the server-only module in the client environment via a Vite
   plugin.

### F.6 "Prisma `db push` Was Used — Now What"

- Compare schema to migrations with `prisma migrate diff` (see
  CLAUDE.md § 5 Schema Drift Check).
- Generate a migration from the drift:
  ```bash
  prisma migrate diff \
    --from-migrations prisma/migrations \
    --to-schema-datamodel prisma/schema.prisma \
    --script > prisma/migrations/<timestamp>_catchup/migration.sql
  ```
- Make it idempotent (wrap in `IF NOT EXISTS`).
- Commit the generated migration.
- Going forward: `db push` only for local throwaway DBs.

---

## G. Agent Self-Management

### G.1 When to Ask vs Act

**Ask first:**
- Anything irreversible (production DB writes, public API changes,
  destructive git commands).
- Scope unclear (two interpretations of the request).
- Trade-offs with no obvious winner (architectural decisions).
- Budget-sensitive choices (new paid service, large refactor).

**Act without asking:**
- Reading files, running type checks, running tests.
- Editing files within the clearly-stated scope.
- Fixing a test you just broke with your own change.
- Choosing between two equivalent stylistic options (which exists in repo).

### G.2 When to Use Subagents

Delegate to a subagent when:
- The work is large (50+ files) and parallelizable.
- The work is exploratory research that will add a lot to context.
- The subagent has specialized skills (code review, security audit,
  documentation).

**Don't delegate:**
- Simple 1-2 file edits.
- When you need iterative feedback.
- When the context cost of briefing exceeds the work itself.

### G.3 When to Stop and Reconsider

Stop if any of these are true:
- You've tried 3+ approaches and none work.
- The fix requires touching code far outside the original scope.
- You notice an inconsistency between the doc and the codebase that's
  material.
- You're about to use a hack (`as any`, `--no-verify`, `eslint-disable`).
- Your confidence that the approach is right < 70%.

Ask the user, summarize what you've tried, propose 2-3 next steps.

### G.4 Long-Running Sessions

If the session context is getting large:
- Use task/todo lists to track state externally.
- Save critical findings to a notes file (`docs/notes/<date>-<topic>.md`)
  so they survive context pruning.
- Use worktrees so you don't lose work to a pkill.
- Commit frequently — a recoverable `git log` beats a lost hour of work.

---

## H. Communication Patterns

### H.1 Status Updates During Long Tasks

Every 2-3 tool calls on multi-step work, tell the user:
- What you just did (1 line)
- What you're about to do (1 line)
- Anything that needs their attention

Keep it short. `✓ Migration added. 🔄 Running type-check. ⏳ Admin UI next.`
is better than a paragraph.

### H.2 Asking Clarifying Questions

- **Ask one question at a time.** Walls of questions overwhelm.
- **Propose a default.** "Should I do A or B? Default: A because it matches
  the existing pattern."
- **Don't re-ask answered questions.** Read the earlier message chain.

### H.3 Reporting Results

- **Lead with the outcome.** "Feature done, 3 tests passing."
- **Then mention what changed.** Bullet list.
- **End with next steps or verification pointers.**
- Keep it ≤ 100 words unless asked for detail.

---

## I. Stopping Criteria

Consider the task done when:
1. All planned steps are implemented.
2. Tests pass (unit + integration + type check + lint).
3. Manual smoke test passes (the feature actually works in the browser /
   simulator).
4. User-facing strings are translated.
5. New env vars documented in `.env.example`.
6. Migrations are idempotent and tested.
7. No `TODO` / `FIXME` / `console.log` left in the diff.

If any of these is false, you're not done — even if the user doesn't ask.
