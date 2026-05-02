# CLAUDE.md — Universal Project Conventions

> Drop this file into the root of any project. It encodes the conventions that
> all AI agents (Claude Code, Copilot, Cursor, etc.) must follow when working on
> the codebase. Pair with `AGENTS.md` (task-oriented procedures). Override any
> section by placing a project-specific `CLAUDE.md` **above** this one in the
> file tree or by adding a section marked `## Project-Specific Overrides` at
> the top.

---

## 0. Language & Communication

- **Default language for user-facing strings:** Polish with full diacritics
  (`CZĘŚCIOWO`, not `CZESCIOWO`). Override in project root when needed.
- **Code comments, commit messages, PR descriptions:** English.
- **Always respond in the same language the user uses.** If they write in
  Polish, reply in Polish. If in English, reply in English.
- Communication style: short, concise, zero fluff. No recap of what just
  happened unless asked. No emojis unless explicitly requested.

---

## 1. Behavioral Principles (Non-Negotiable)

**Bias toward caution over speed.**

- **Think before coding.** State assumptions explicitly. If multiple
  interpretations exist, present them — don't pick silently. If a simpler
  approach exists, say so. Push back when warranted.
- **Simplicity first.** Minimum code that solves the problem. No speculative
  abstractions. No error handling for impossible scenarios. If 200 lines can
  be 50, rewrite it.
- **Surgical changes.** Touch only what you must. Match existing style. Don't
  "improve" adjacent code, comments, or formatting. Every changed line must
  trace to the user's request.
- **Goal-driven.** Transform tasks into verifiable goals. For multi-step
  tasks, state a brief plan with verification steps.
- **Never guess configuration or credentials.** If you don't know, ask.

### Red flags — stop immediately

| Thought | Reaction |
|---------|----------|
| "Let me also refactor this while I'm here" | Don't. Only touch what was asked. |
| "I'll add error handling just in case" | Only add for real boundaries. |
| "Maybe the user wanted this other thing" | Ask, don't assume. |
| "This hack will work for now" | No. Find the root cause. |
| "I'll skip the test, it's just a small change" | Follow the TDD loop. |
| "I'll use `any` to unblock" | Fix the type properly. |

---

## 2. Architecture Patterns

### SOLID Principles

**S — Single Responsibility**
- Each file has ONE reason to change.
- Components render UI only — delegate logic to hooks, data to services.
- Services handle data access only — no navigation, alerts, UI state.
- Hooks over 150 lines likely do too much — split into focused hooks.

**O — Open/Closed**
- Shared components (`shared/ui/*`, `shared/hooks/*`) are extended via
  composition/wrappers, never modified for a single feature.
- Feature-specific behavior goes in new files (hooks, components), not
  if/else branches in existing ones.
- Use CVA variants + `className` overrides to extend UI primitives.
- CRUD factories are extension points — spread + add methods, never
  override base methods.

**L — Liskov Substitution**
- All implementations of an interface honor the same contract.
- Hooks composing a base hook MUST return its full interface.
- Components accepting `onPress`, `onChange`, etc. MUST call them
  consistently — don't silently swallow events.

**I — Interface Segregation**
- Keep props interfaces focused — 10+ properties = split the component.
- NEVER pass entire domain objects as props if only 2-3 fields are used.
- Hook return objects must be destructurable — callers pick what they need.
- Platform-specific callbacks (`onAlert`, `onDelete`) are optional, never
  required.

**D — Dependency Inversion**
- Features import from other features ONLY through `index.ts` barrel.
  Importing internal files (`@features/X/hooks/useY` from another feature)
  is forbidden.
- Screens depend on hooks (abstraction), hooks depend on services
  (abstraction). Never skip layers (screen calling service directly).
- Platform APIs (`Alert`, `AsyncStorage`, `localStorage`, `Haptics`) live in
  screens/hooks. Services stay platform-agnostic.
- Shared code (`src/shared/`) NEVER imports from `src/features/`. Dependency
  flows one way.

### Feature-First Folder Structure

```
apps/<app>/
├── src/
│   ├── app/                    # Thin routing shell (Next.js, Expo Router, TanStack Router)
│   ├── features/               # Domain code — one folder per business domain
│   │   └── <feature-name>/
│   │       ├── index.ts        # PUBLIC API — barrel export; only imports go here
│   │       ├── components/     # Feature-local UI
│   │       ├── hooks/          # Feature-local hooks
│   │       ├── screens/        # (mobile) smart/container components
│   │       ├── services/       # Data-access layer
│   │       ├── schemas/        # Feature-local Zod/validation
│   │       ├── utils/          # Feature-local helpers
│   │       └── constants.ts    # Feature constants (labels, enums)
│   └── shared/                 # Cross-cutting code
│       ├── ui/                 # Atomic design primitives (Button, Card, Input)
│       ├── components/         # Composite shared widgets
│       ├── hooks/              # Cross-cutting hooks
│       ├── services/           # Cross-cutting services (auth, api client)
│       ├── stores/             # Global state (Zustand, Redux)
│       ├── utils/              # Pure helpers
│       ├── lib/                # Third-party adapters
│       ├── config/             # Feature flags, runtime config
│       └── types/              # Cross-cutting TypeScript types
├── public/                     # Static assets (web)
└── assets/                     # Bundled assets (mobile)
```

**Golden rules:**
- **ONE component per file.** Never put multiple components in one file.
- **Files under 500 lines.** Prefer under 300.
- **Only `index.ts` at feature root.** No files directly in `features/<name>/`
  except the barrel export (and optionally a `<feature>.ts` for constants).
- **Feature-to-feature imports only via `index.ts`.** Internal imports between
  features are forbidden.
- **Never save files to project root.** Use appropriate subdirs:
  - `/src` source code
  - `/tests` test files
  - `/docs` documentation
  - `/config` configuration
  - `/scripts` utility scripts
  - `/examples` example code

### Clean Architecture Layers

```
UI layer (screens, pages, components)
    ↓ uses
Hook layer (useX — business logic, orchestration)
    ↓ calls
Service layer (platform-agnostic data access)
    ↓ calls
API client / Database
```

UI never calls services directly. Services never import React or hooks.

---

## 3. Code Style

### TypeScript

- **Strict mode on.** `strict: true` in tsconfig.
- **No `any`.** Use `unknown` for truly unknown data and narrow it.
- **No non-null assertions (`!`).** Use explicit guards.
- **Prefer `interface` for object shapes, `type` for unions/intersections.**
- **Return types on exported functions.** Inferrable internally, explicit on
  API surface.
- **Enum alternatives:** prefer `as const` objects over TS `enum`. Exception:
  Prisma / database enums stay as TS enums.

### Naming

- `PascalCase`: types, interfaces, components, classes, enum values.
- `camelCase`: variables, functions, hooks (prefixed `use`), methods.
- `SCREAMING_SNAKE_CASE`: module-level constants that are truly static.
- `kebab-case`: file names for non-component files (`user-store.ts`).
- `PascalCase.tsx`: component file names.
- `_prefix`: intentionally unused params (`_unused`).
- Booleans: `is`, `has`, `can`, `should` prefix (`isLoading`, `hasAccess`).

### Imports

- **Path aliases over relative paths deep than `../`.** Use `@features/*`,
  `@shared/*`, `@<lib-name>/*`.
- **Import order:**
  1. Node built-ins
  2. External packages
  3. Monorepo shared libs (`@<project>/<lib>`)
  4. App-internal aliases (`@shared/*`, `@features/*`)
  5. Relative imports
- **No circular imports.** Enforce with `madge --circular src/`.
- **Delete unused imports.** Don't leave them for "maybe later".

### Formatting

- **Prettier + ESLint.** Single source of truth: config file in repo root.
- **Single quotes, 2-space indent, trailing commas, no semicolons** — unless
  project enforces otherwise.
- **Line length ≤ 100 chars** (120 acceptable for long strings).

### Comments

- **Default: no comments.** Well-named identifiers explain the WHAT.
- **Only comment the WHY when non-obvious:** hidden constraints, invariants,
  workarounds for specific bugs, surprising behavior.
- **Never describe the current task or fix.** ("Added for X flow",
  "Handles issue #123" — belongs in PR description, not code.)
- **No multi-paragraph docstrings.** Keep to one short line.
- **JSDoc `@param` / `@returns` only for published libraries.**

---

## 4. Libraries — Canonical Choices

> Pick ONE library per category. Use these defaults unless project has a
> documented reason to differ.

### Core

| Need | Library |
|------|---------|
| Runtime (mobile) | Expo SDK (latest LTS) |
| Runtime (web SPA) | Vite + React |
| Runtime (web SSR) | TanStack Start + Nitro, or Next.js App Router |
| Runtime (backend) | NestJS 11 (Node) / Fastify (lightweight) |
| Package manager | `bun` (monorepo) / `pnpm` (standalone) |
| Monorepo | Nx (task orchestration) + workspace protocol |
| TypeScript | Latest stable (5.x) |

### Data & State

| Need | Library |
|------|---------|
| Server state | **TanStack Query** (never Redux/Context for server data) |
| Client state (global) | **Zustand** (never Redux unless justified) |
| Client state (local) | `useState` / `useReducer` |
| Forms | **React Hook Form + Zod** (`@hookform/resolvers/zod`) |
| Validation | **Zod** (shared schemas in monorepo lib) |
| Date | **date-fns** (tree-shakeable) — NOT moment |
| Math / decimals | Native + `toFixed` for display. Use Decimal.js only for money |

### Database & ORM

| Need | Library |
|------|---------|
| RDBMS | PostgreSQL |
| ORM | **Prisma** |
| Cache | Redis |
| Storage | S3 (or MinIO locally) |
| Queue | BullMQ (Redis-backed) |

### UI

| Need | Library (web) | Library (mobile) |
|------|--------------|------------------|
| Styling | **Tailwind v4** + Shadcn primitives | **Uniwind** (Tailwind for RN) |
| Icons | **lucide-react** | `@expo/vector-icons` (Ionicons) |
| Charts | **Recharts** | Victory Native |
| Tables | **TanStack Table** | FlatList + custom |
| Animation | CSS / Framer Motion | Reanimated 3 |
| Toast | Shadcn `sonner` | Custom |
| Modal | Shadcn `Dialog` | React Native Modal |

### Mobile-specific

| Need | Library |
|------|---------|
| Navigation | **Expo Router v6** (file-based) |
| Storage (secrets) | `expo-secure-store` (native) / `localStorage` (web) |
| Storage (fast) | `react-native-mmkv` (if available) |
| Localization | `expo-localization` |
| Haptics | `expo-haptics` |
| Push | `expo-notifications` |
| Keyboard handling | **`react-native-keyboard-controller`** (see § 7a) |
| Analytics | **PostHog** (`posthog-react-native`) |
| Error monitoring | **Sentry** (`@sentry/react-native`) |

### Backend-specific

| Need | Library |
|------|---------|
| Validation | Zod (via `nestjs-zod`) — prefer over class-validator for new code |
| Auth | JWT + refresh token rotation (custom, no Passport complexity) |
| HTTP client | Native `fetch` — NOT axios |
| Testing | Jest + Supertest (e2e) |
| Payments | Stripe (international) + Przelewy24 (PL) |
| Email | Resend |

### Code Quality

| Need | Library |
|------|---------|
| Linter | ESLint (flat config) |
| Formatter | Prettier |
| Pre-commit | Husky + lint-staged |
| Commit format | Conventional Commits (`feat:`, `fix:`, `chore:`) |
| Testing | **Vitest** (new projects) / Jest (legacy) |
| E2E web | Playwright |
| E2E mobile | Maestro |

---

## 5. API Conventions (NestJS / REST)

### Global Guard Chain (in order)

1. **ThrottlerGuard** — 30 req/min per IP by default
2. **JwtAuthGuard** — all routes protected by default; bypass with `@Public()`
3. **RolesGuard** — `@Roles(Role.ADMIN, Role.USER)` for role gates
4. **FeatureFlagGuard** — `@FeatureFlag('featureName')`
5. **SubscriptionGuard** — enforces subscription; bypass with
   `@SkipSubscription()`

### Routing Rules

- **Static routes BEFORE parameterized.** `@Get('stats')` must come before
  `@Get(':id')`.
- **Controllers group by domain, not layer.** `UserController` not
  `GetController`.
- **Plural resources, nested hierarchy.** `GET /users/:id/posts`, not
  `/user/:id/getPosts`.
- **HTTP verbs map to actions:**
  - `GET` — read (idempotent)
  - `POST` — create
  - `PATCH` — partial update
  - `PUT` — full replace (rare, prefer PATCH)
  - `DELETE` — remove

### DTO / Validation

- **New endpoints use Zod** (via `createZodDto` from `nestjs-zod`). Shared
  schemas live in a monorepo lib (`@<project>/validation`).
- **All schemas `.strict()`** — unknown keys rejected with 400.
- **Update DTOs are standalone** `z.object({...}).strict()` — NEVER
  `.partial()` of create schema (accidentally strips required fields).
- **Mass-assignment defense.** Strip `id`, `userId`, `createdAt`,
  `updatedAt`, `deletedAt` from update payloads server-side via a helper —
  even if client sends them, Prisma ignores them.

### Error Responses

- **Always include a machine-readable `code` + user-facing `message`.**
- Use consistent error codes (`PATIENT_NOT_FOUND`, `INVALID_CLINIC_CODE`).
- HTTP status codes match the semantic:
  - 400: validation/domain rule failure
  - 401: missing/invalid auth
  - 403: authenticated but forbidden
  - 404: resource doesn't exist
  - 409: conflict (duplicate)
  - 422: semantically invalid (business rule)

Good:
```ts
throw new NotFoundException({ message: 'Patient not found', code: 'PATIENT_NOT_FOUND' });
```

Bad (English + no code):
```ts
throw new NotFoundException('Patient not found');
```

### Security Essentials

- **Passwords:** bcrypt, 12+ rounds.
- **JWT secret:** 32+ chars, refuse to start otherwise.
- **Refresh tokens:** stored as SHA-256 hash in DB, plaintext sent to client
  via httpOnly cookie only.
- **Rate limiting:** per-IP baseline + per-route throttles on sensitive ops.
- **IDOR defense:** use proxy pattern (e.g., `withDoctorAccess(prisma,
  patientId, requesterId, role)`) for cross-user data access. Never trust
  client-sent IDs without ownership check.
- **CORS:** whitelist explicit origins.

### Date & Timezone

- **Always use timezone-aware helpers.** `startOfDayTz(tz, date)`,
  `getUserDayBoundsSync(tz, date)`.
- **NEVER `.toISOString().split('T')[0]`** for "today" — UTC grouping bug.
- **Store UTC, render in user tz.**

### Prisma / Migrations

- **`prisma db push` is BANNED for shared environments.** Only local
  throwaway. Always create migration files with `prisma migrate dev`.
- **Synthetic timestamps** (`YYYYMMDDHHMMSS`). Never insert a natural
  timestamp between existing migrations — breaks order.
- **All migrations idempotent:** `CREATE TABLE IF NOT EXISTS`,
  `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, FK wrapped in
  `DO $$ IF NOT EXISTS ... END $$`.
- **Schema drift check before pushing to CI:**
  ```bash
  prisma migrate diff \
    --from-migrations prisma/migrations \
    --to-schema-datamodel prisma/schema.prisma \
    --shadow-database-url $SHADOW_DB_URL \
    --exit-code
  ```
- **Soft delete convention:** `deletedAt DateTime?` + Prisma middleware that
  auto-filters `deletedAt: null`. Transparent to callers.

### Adding a Column — Full Checklist

Touch all four layers or the column silently breaks somewhere:
1. `prisma/schema.prisma` — declare the column
2. `prisma migrate dev --name <change>` — create migration (idempotent SQL)
3. `libs/validation` — add to Create + Update Zod schemas
4. Frontend API clients — update typed interfaces (Orval / hand-written)

---

## 6. Frontend Conventions

### React

- **Hooks only. No class components.**
- **One component per file.** Named export preferred over default.
- **Props interface above component, same file.**
- **`React.memo` with `displayName`** for components that render in lists or
  receive stable props.
- **Event handlers in `useCallback`** if passed to memoized children.
- **Avoid `useEffect` for derived state.** Compute during render.
- **Do not mount effects that fetch** — use TanStack Query.

### Component Shape

```tsx
interface ProfileCardProps {
  userId: string
  onEdit?: () => void
}

const ProfileCardInner = ({ userId, onEdit }: ProfileCardProps) => {
  const { data: user, isLoading } = useUser(userId)

  const handleEdit = useCallback(() => {
    onEdit?.()
  }, [onEdit])

  if (isLoading) return <Skeleton />
  if (!user) return null

  return (
    <Card onPress={handleEdit}>
      <Text>{user.name}</Text>
    </Card>
  )
}

export const ProfileCard = React.memo(ProfileCardInner)
ProfileCard.displayName = 'ProfileCard'
```

### State

- **Server state → TanStack Query.**
- **Global client state → Zustand** (one store per domain).
- **URL state → router's query params** (TanStack Router `validateSearch`,
  Next.js `useSearchParams`).
- **Form state → React Hook Form.**
- **Local UI state → `useState`.**

### TanStack Query

- **Query options shared factory.** `apiQueryOptions('/endpoint')` returns a
  `queryOptions` object reusable across loaders, prefetching, and hooks.
- **Mutations via `useApiMutation`** helper that wraps invalidation.
  Never raw `mutate` with manual invalidation scattered across components.
- **Config:** `staleTime: 5_000`, `gcTime: 30 * 60_000`,
  `refetchOnWindowFocus: false` on mobile, `true` on web.
- **Query keys are arrays:** `['user', userId]`, not strings.

### Routing

- **File-based routing is the default.** Expo Router / TanStack Router /
  Next.js App Router.
- **Typed links** — use framework-provided typed `<Link>`:
  - Good: `<Link to="/users/$id" params={{ id }} />`
  - Bad: `<Link href={\`/users/${id}\`} />` (no type-safety)
- **Loader-based data fetching** where framework supports it. Loader
  hydrates the query cache; component reads via `useQuery`.

### Component Inventory — Project Components Only

Every UI element must be built from components in `@shared/ui/*` or
`@shared/components/*`. External UI libraries (Shadcn primitives, Radix,
Headless UI, etc.) are internal implementation details of shared
components — never imported directly in feature code.

**Rules:**
1. **Never import from an external UI library in feature code.** Import
   from `@shared/ui/*` instead. External primitives are wrapped once in
   the shared layer and consumed everywhere else.
2. **If a needed component doesn't exist in `@shared/ui/`**, create it
   there. Follow the existing pattern: CVA variants, `className` support,
   consistent props API, design tokens only. Do not inline the missing
   component in the feature.
3. **If a component exists but lacks a needed variant**, extend the
   existing component with a new CVA variant — don't create a parallel
   component or inline styles to work around it.
4. **Every screen and page is composed exclusively from shared
   primitives and feature-local components.** No raw `<div>` + Tailwind
   for what is fundamentally a reusable widget (cards, list items,
   modals, form fields, badges, toasts, etc.).

**Why:** A centralized component library ensures visual consistency,
enforces design tokens, and allows single-point fixes for accessibility,
styling, or behavior changes across the entire app.

---

## 6a. Forms — React Hook Form + Zod

### Canonical Stack

Every form — web or mobile — uses the same three libraries:

- **`react-hook-form`** (RHF) — form state machine, re-renders only
  subscribed fields, uncontrolled by default.
- **`zod`** — single source of truth for validation. Schema lives in
  `libs/shared/validation/` if shared with backend, otherwise colocated
  with the feature in `features/<name>/schemas/<name>-form.ts`.
- **`@hookform/resolvers/zod`** — bridges RHF to Zod.

No Formik. No raw `useState` chains. No `yup`. If a form has > 2 fields,
it uses RHF.

### Schema Pattern

```ts
// features/auth/schemas/sign-in-form.ts
import { z } from 'zod';

export const SignInSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
}).strict();

export type SignInFormInput = z.input<typeof SignInSchema>;
export type SignInFormOutput = z.output<typeof SignInSchema>;
```

- **`.strict()`** — unknown fields rejected (paranoid mode).
- **Error messages in the project's primary locale** (shown in English here for clarity).
- **Export both `Input` and `Output` types** — `Input` is what the form
  accepts (pre-parse), `Output` is what it emits after Zod coerces
  (e.g., string → number). Forms use `Input`, submit handlers use `Output`.

### Component Pattern

```tsx
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { SignInSchema, type SignInFormInput } from '../schemas/sign-in-form';

export function SignInForm() {
  const { control, handleSubmit, formState: { errors, isSubmitting } } =
    useForm<SignInFormInput>({
      resolver: zodResolver(SignInSchema),
      defaultValues: { email: '', password: '' },
      mode: 'onBlur',
    });

  const onSubmit = async (data: SignInFormInput) => {
    // ... submit logic
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <ControlledInput
        control={control}
        name="email"
        label="Email"
        error={errors.email?.message}
      />
      <ControlledInput
        control={control}
        name="password"
        type="password"
        label="Password"
        error={errors.password?.message}
      />
      <Button type="submit" disabled={isSubmitting}>Sign in</Button>
    </form>
  );
}
```

### Controlled Inputs (recommended)

Create a `ControlledInput` wrapper in `@shared/ui/` that uses RHF's
`Controller` under the hood — keeps form components terse, consistent
error rendering.

```tsx
// shared/ui/ControlledInput.tsx
import { Controller, type Control, type FieldValues, type Path } from 'react-hook-form';
import { Input } from './Input';

interface ControlledInputProps<T extends FieldValues> {
  control: Control<T>;
  name: Path<T>;
  label?: string;
  error?: string;
  type?: string;
  placeholder?: string;
  disabled?: boolean;
}

export function ControlledInput<T extends FieldValues>({
  control,
  name,
  error,
  ...rest
}: ControlledInputProps<T>) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <Input
          {...rest}
          value={field.value ?? ''}
          onChangeText={field.onChange}
          onBlur={field.onBlur}
          error={error}
        />
      )}
    />
  );
}
```

Mobile uses the same pattern — Controller wraps any `Input` that has
`onChangeText` (RN) instead of `onChange` (web).

### Validation Modes

| Mode | When |
|------|------|
| `onBlur` | Default — validate when user leaves a field |
| `onChange` | Real-time validation (password meter, live filter) |
| `onSubmit` | Big forms where field count makes `onBlur` thrashy |

Always set `mode` explicitly. Don't rely on the RHF default.

### Pre-Submit Warnings (non-blocking)

For domain-specific warnings that shouldn't block submission (e.g.,
"target weight unusually low"), add a separate `checkWarnings(values)`
function returning `string | null`. Call it from the submit handler
and show an `Alert.alert` / `confirm()` before calling the mutation.

Do NOT put warnings in the Zod schema — Zod is for hard validation,
warnings are a UX layer.

### Submitting

- **Disable submit button while `isSubmitting`** (RHF tracks this).
- **Call mutations from submit handler**, not from `onClick` elsewhere.
- **Invalidate queries on success** — use `useApiMutation` helper.
- **Show errors via `showApiError(error, { screen, action })`** (mobile)
  or a toast (web). Do NOT silently fail.

### Never Do

- **Never mix controlled + uncontrolled inputs in the same form.** RHF
  expects one pattern.
- **Never read values via `watch()` for derived state** inside a tight
  render path — triggers re-renders on every keystroke. Use `useWatch`
  with specific `name`.
- **Never call `setValue` in a `useEffect`** based on another field's
  value. Use RHF's `defaultValues` + `shouldUnregister: false` or
  computed values in render.
- **Never use `.partial()` of create schema as update schema.** Standalone
  `z.object({...}).strict()` both times — `.partial()` strips required
  fields silently.

---

## 7. Mobile Conventions (React Native / Expo)

### Styling — Uniwind ONLY

- **Use `className` props everywhere.** No `StyleSheet.create()`.
- **Design tokens in `global.css`** (CSS custom properties with `@theme` for
  light/dark).
- **`cn()` utility:** `twMerge(clsx(...))`.
- **CVA for shared components:** export `type VariantProps<typeof cva>`.
- **Pressed states:** `active:opacity-70` / `active:opacity-85`.
- **Shadows:** design tokens (`shadow-card`, `shadow-elevated`).

### Allowed `style=` exceptions

Only use `style={{...}}` when `className` can't express it:
- Dynamic computed values (width percentages, colors with opacity)
- Reanimated animated styles
- SVG `stroke` / `fill`
- Ionicons `color` prop
- Dynamic library configs (Recharts, etc.)

### Platform Patterns

- **`useFocusEffect`** for native screens that need refetch on focus.
- **`useEffect`** for web; mobile skips web-focus events.
- **Dynamic Island blocks taps at `y<59`** on iPhone 16 Pro — buttons below.
- **Two native `Modal`s with `presentationStyle="pageSheet"` can't stack.**
  Inner modal must be fullscreen.
- **SafeAreaProvider not inherited inside `Modal`.** Wrap modal content with
  its own `<SafeAreaProvider>` or use hardcoded iOS-safe padding.
- **React Query `refetchOnWindowFocus`** — web-only. Mobile must disable
  (`Platform.OS === 'web'`).

### Error Handling

- **API errors:** `showApiError(error, { screen, action })` — centralized
  helper that maps error codes to localized strings + Sentry breadcrumb +
  captures 5xx/network errors.
- **Local validation / clinical warnings:** plain `Alert.alert` is fine.
- **NEVER raw `Alert.alert('Error', error.message)`** — leaks English
  exception text to the user.

### Component Inventory — Same Rules Apply

Mobile follows the same component-only rule. Every visual element is
built from `@shared/ui/*` or feature-local components.

- **Never use raw `<View>` + Tailwind classes to build what is clearly a
  reusable widget** (card, list item, bottom sheet, action row, etc.).
  Create a shared component instead.
- **Never import `react-native` primitives directly** when a wrapped
  shared component already exists (`Button`, `Card`, `Input`, `Badge`,
  `Avatar`, etc.).
- **If a mobile-specific component is missing**, create it in
  `@shared/ui/` following the existing pattern (CVA variants,
  `className`, consistent props API).
- **If a component needs a mobile-specific variant** (e.g., touch target
  sizing, native feedback), add a variant to the existing component —
  don't duplicate it with a `Mobile` suffix.

---

## 7a. Keyboard Handling (Mobile Only)

### Canonical Library — `react-native-keyboard-controller`

Built-in `KeyboardAvoidingView` is legacy — laggy, platform-divergent,
fights with modals. Use
[`react-native-keyboard-controller`](https://kirillzyusko.github.io/react-native-keyboard-controller/)
instead.

Why:
- Smooth 60 fps animations synced to keyboard movement (native driver).
- Works consistently on iOS + Android (no `behavior="padding"` vs
  `"height"` hacks).
- Integrates cleanly with modals, bottom sheets, scroll views.
- Declarative API that hooks into RN gesture handler + Reanimated.

### Install

```bash
bunx expo install react-native-keyboard-controller
```

Add to `app.json` plugins if needed (check package docs for current SDK).

### Global Provider

Wrap the app once, at the root layout:

```tsx
// app/_layout.tsx
import { KeyboardProvider } from 'react-native-keyboard-controller';

export default function RootLayout() {
  return (
    <KeyboardProvider>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <QueryProvider>
            <Slot />
          </QueryProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </KeyboardProvider>
  );
}
```

### Primary Primitives

| Component / Hook | When to Use |
|------------------|-------------|
| `<KeyboardAvoidingView>` | Replace RN's built-in version. Same API, better behavior. |
| `<KeyboardAwareScrollView>` | Scroll content so focused input is always visible. Default for multi-field forms. |
| `<KeyboardToolbar>` | Native iOS-style toolbar above keyboard — "Done" / "Previous" / "Next" buttons. |
| `useKeyboardHandler()` | Custom reactions to keyboard events (animations synced to keyboard). |
| `useReanimatedKeyboardAnimation()` | Reanimated shared values tracking keyboard height/state. |

### Patterns

**Pattern 1: Form in a modal** — use `KeyboardAwareScrollView`:

```tsx
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';

<Modal visible={open} presentationStyle="pageSheet">
  <KeyboardAwareScrollView
    bottomOffset={20} // extra space between focused input and keyboard
    className="flex-1"
  >
    <ControlledInput control={control} name="email" />
    <ControlledInput control={control} name="password" />
    <Button onPress={handleSubmit(onSubmit)}>Save</Button>
  </KeyboardAwareScrollView>
</Modal>
```

**Pattern 2: Single full-screen input** — `KeyboardAvoidingView` is enough:

```tsx
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';

<KeyboardAvoidingView behavior="padding" className="flex-1">
  <TextInput ... />
  <Button ... />
</KeyboardAvoidingView>
```

**Pattern 3: Next-field navigation** — add `KeyboardToolbar`:

```tsx
import { KeyboardToolbar } from 'react-native-keyboard-controller';

// At the root of the form screen, once:
<KeyboardToolbar />

// Then inputs automatically get "Previous" / "Next" / "Done" buttons.
// Inputs must have a `returnKeyType="next"` and `onSubmitEditing`
// chain (RHF's Controller forwards the ref properly).
```

### Rules

- **NEVER use RN's built-in `KeyboardAvoidingView`** — replace imports
  at adoption time:
  ```ts
  // ❌ Bad
  import { KeyboardAvoidingView } from 'react-native';
  // ✅ Good
  import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
  ```
- **NEVER manually animate views based on `Keyboard.addListener`** —
  use `useKeyboardHandler` or `useReanimatedKeyboardAnimation`.
- **Always dismiss on outer tap** for non-scroll screens — wrap tappable
  area with `Pressable onPress={Keyboard.dismiss}` or enable
  `keyboardShouldPersistTaps="handled"` on ScrollView.
- **Test on physical device** — simulator keyboard can be hidden with
  Cmd+K, which masks issues. Focus behavior differs.

### When NOT to Use

- **Web builds** — `react-native-keyboard-controller` is native-only.
  Use pure CSS / `overflow-auto` on web equivalents.
- **Simple single-input modals that auto-close** — native keyboard
  handles them without library support.

---

## 8. Backend/Frontend Sync

### Shared Libraries in Monorepo

```
libs/shared/
├── types/           # @<project>/types — TypeScript definitions
├── validation/      # @<project>/validation — Zod schemas
├── utils/           # @<project>/utils — pure helpers (clinical constants, etc.)
└── api-client/      # @<project>/api-client — shared fetch wrapper (auth adapter pattern)
```

- **Types travel across boundaries.** `UserWithProfile` defined once in
  `types`, consumed by API, admin, mobile.
- **Validation schemas are the contract.** Both API (for request parsing)
  and frontend (for form validation) import the same Zod schema.
- **API client:** shared factory `createApiClient(authAdapter, { baseUrl })`
  — mobile passes `mobileAuthAdapter` (SecureStore), admin passes
  `adminAuthAdapter` (cookies).

### Code Generation

- **Orval** generates frontend API clients from OpenAPI/Swagger JSON.
- **Generated code is gitignored.** Always a build step.
- **After API schema change:** run generator before frontend lint/type check.

---

## 9. Translations & i18n

### Language Convention

- **User-facing strings in the app's primary locale with full diacritics.**
- Secondary locales live in JSON files, switched via `i18next` +
  `react-i18next` (or platform-equivalent).
- **Backend error messages** include a `code` for frontend to map to
  localized strings. Message field is a fallback in the primary locale.

### i18n Setup

```ts
// shared/i18n/setup.ts
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import pl from './locales/pl.json';
import en from './locales/en.json';

const deviceLang = getLocales()[0]?.languageCode ?? 'pl';
const supportedLang = ['pl', 'en'].includes(deviceLang) ? deviceLang : 'pl';

i18n.use(initReactI18next).init({
  resources: { pl: { translation: pl }, en: { translation: en } },
  lng: supportedLang,
  fallbackLng: 'pl',
  interpolation: { escapeValue: false },
  compatibilityJSON: 'v4',
  keySeparator: false, // flat keys: 'subscription.title'
});
```

### Key Conventions

- **Flat keys with dot-namespaced convention:** `subscription.choosePlan`,
  `profile.saveChanges`.
- **`keySeparator: false`** — keys are literal strings, not nested lookups.
- **Placeholders with interpolation:** `"trialDays": "{{count}} days remaining"`.
- **Plurals:** i18next plural suffixes (`_one`, `_other`, `_few` for Polish).

### Rules — NEVER Do

- **NEVER hardcode English in API error messages.** Frontend fallback surfaces
  raw message to user.
- **NEVER throw raw Prisma/JS error strings** as HTTP exception messages.
- **NEVER add a new domain field without adding a translation** for its
  validation-error label (e.g., `FIELD_LABELS['totalHours'] = 'Total hours'`).
  Missing entries fall back to camelCase splitting — ugly in production.

### Adding a New Translatable String — Checklist

1. Add key to primary locale JSON (`pl.json`).
2. Add key to all other locale JSONs (`en.json`, etc.) — even as a TODO
   copy of primary.
3. Replace hardcoded string in UI with `t('key.name')`.
4. For API error codes: add a `case` branch in the frontend error mapper.

---

## 10. Testing

### Strategy

- **Unit tests for pure logic** (validators, reducers, utility functions).
- **Integration tests for API endpoints** (Supertest + test DB).
- **Component tests for complex UI** (React Testing Library).
- **E2E tests for critical user flows** (Playwright web / Maestro mobile).
- **Don't test framework code.** Don't test that `useState` works.

### Coverage Targets

- **Line coverage ≥ 80%** on non-UI code (enforced in CI).
- **UI coverage is not the point** — focus on integration & E2E for flows.
- **Branch coverage for business-logic modules: 90%.**

### Test Organization

- Colocate unit tests: `foo.ts` + `foo.spec.ts` in same folder.
- Integration tests: `apps/api/test/` with descriptive names
  (`auth-signup.e2e-spec.ts`).
- Test fixtures: `<project-root>/test-fixtures/` — shared seed data.

### Conventions

- **Arrange / Act / Assert** structure.
- **One behavior per test.** Split if "and" appears in the test name.
- **Factory functions over fixture JSON** for object construction:
  `const user = makeUser({ email: 'x@y.z' })`.
- **Integration tests hit a real database**, not mocks. Mock/prod divergence
  masks real bugs.

---

## 11. Git & Deployment

### Git Workflow

- **Branch naming:** `feat/<short-description>`, `fix/<issue>`,
  `chore/<task>`. Lowercase with hyphens.
- **Conventional Commits:** `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`,
  `test:`, `perf:`. Scope optional: `feat(auth): ...`.
- **PR titles mirror the merge commit message.**
- **Squash merges** for feature branches. Rebase before merging to avoid
  merge commits.

### Safety Rules

- **NEVER `--no-verify`** to skip hooks unless explicitly requested.
- **NEVER `push --force`** to main. Force-pushing to feature branches is OK.
- **NEVER run destructive commands** (`git reset --hard`, `rm -rf`) without
  explicit confirmation.
- **Create new commits instead of amending** — amending published commits
  re-writes history and breaks others' work.
- **Stage specific files** (`git add src/foo.ts`), not `git add .` — avoids
  accidentally committing secrets.

### Deployment

- **Backend:** Railway / Fly / Render (native GitHub integration,
  auto-deploy on push).
- **Web frontend:** Vercel (native integration).
- **Mobile:** EAS Build → TestFlight / Play Store Internal Track.
- **No CI build job in GitHub Actions for deploys** if using native Git
  integrations — duplicates work.
- **CI runs:** lint, type check, tests, audit. Not deployment.

---

## 12. Security Essentials

### Secrets

- **NEVER commit secrets.** `.env` in `.gitignore`. Use `.env.example`.
- **Secret rotation policy:** document rotation cadence for production secrets.
- **Dev secrets are fake.** Don't reuse production keys in dev.

### Input Validation

- **Validate at boundaries only.** User input (HTTP body, URL params),
  external API responses, webhook payloads. Don't validate internal code.
- **Zod everywhere at the boundary.** Not just "most of the time".

### OWASP Top 10

- **Injection:** Prisma parameterizes queries; never string-concat SQL.
- **Broken auth:** Session tokens are SHA-256 in DB. Refresh rotation.
- **XSS:** React escapes by default. Never inject raw HTML without an
  explicit sanitizer like DOMPurify.
- **CSRF:** httpOnly cookies + SameSite=Lax + CORS whitelist.
- **Rate limiting:** Every public endpoint.
- **Logging:** Never log passwords, full tokens, PII. Hash sensitive values
  before logging.

---

## 13. Monitoring & Observability

- **Error tracking:** Sentry (web + mobile + backend). Tag by release, user,
  feature flag.
- **Analytics:** PostHog for product metrics. Feature flags live there.
- **Structured JSON logs** in production. Include `correlationId`, `userId`,
  `route`.
- **Health endpoints:** `GET /health` returns `{ status: 'ok', db: 'ok' }`.

---

## 14. Performance

- **Bundle size budgets:** document per-app. Break on regression.
- **Database indexes:** index fields used in `WHERE`, `ORDER BY`, FK joins.
- **Pagination:** cursor-based for large lists. `limit + offset` only for
  small bounded sets.
- **N+1 queries:** use Prisma `include` / `select` with relations. Monitor
  query count in dev logs.
- **Image optimization:** `<Image>` (Next.js/Expo) with explicit dimensions.

---

## 15. Accessibility

- **Labels on all form fields.** `<label htmlFor>` or `aria-label`.
- **Keyboard navigation:** focus trap in modals, Escape closes.
- **Color contrast:** WCAG AA minimum (4.5:1 for text).
- **Screen readers:** semantic HTML (`<nav>`, `<main>`, `<article>`).
  React Native: `accessibilityLabel`, `accessibilityRole`.

---

## 16. Project-Specific Overrides

> When adopting this doc into a new project, append a `## Overrides` section
> below (DO NOT edit the sections above — they are the universal baseline).
> Example:

```md
## Overrides

- Package manager: npm (bun not supported by our CI image)
- UI primary locale: English
- Mobile styling: StyleSheet (legacy app, not migrated to Uniwind yet)
- Backend framework: Express (pre-dates NestJS adoption)
```

---

## 17. When This Doc is Wrong

If you find a convention that contradicts the actual codebase, do **one** of:
1. The codebase is right and this doc is stale — **update the doc**.
2. The doc is right and the codebase is drifting — flag it to the user,
   don't silently "fix" every violation.
3. The codebase and doc are both right for different modules — add an
   Override section documenting the split.

**Never silently follow the doc if the codebase shows the opposite pattern
at scale.** The codebase is the ground truth; the doc is the intent.
