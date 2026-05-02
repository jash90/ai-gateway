import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    // Out-of-tree files: generated, build output, root-level configs that
    // aren't covered by tsconfig.json's `include`.
    ignores: [
      'dist',
      '.tanstack',
      'src/gen/**',
      'src/routeTree.gen.ts',
      'vite.config.ts',
      'orval.config.ts',
      'eslint.config.js',
    ],
  },
  {
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommendedTypeChecked,
    ],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
      parserOptions: {
        project: ['./tsconfig.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      // Catch real async bugs (same rule as backend).
      '@typescript-eslint/no-floating-promises': 'error',
      // `attributes: false` so async React event handlers
      // (onClick={async () => ...}) don't trip the rule — that's idiomatic.
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false } },
      ],
      // Defensive casts are idiomatic in this codebase — many "unnecessary"
      // assertions are documenting Orval type drift or radix internals.
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      // TanStack Router's `redirect()` returns a Redirect class, which by
      // design is `throw`n inside `beforeLoad`/loaders. The class doesn't
      // extend Error so the rule fires on every redirect. Documented router
      // pattern — disable rule.
      '@typescript-eslint/only-throw-error': 'off',
      // The codebase legitimately uses `any` in a few narrow casts (Orval
      // type drift, radix forwardRef) — keep it manageable, not at error.
      '@typescript-eslint/no-explicit-any': 'off',
      // Common pattern in TanStack Query: unused destructured `_data`.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      // The typed-linting "no-unsafe-*" series fires loudly on the custom
      // fetcher in shared/lib/api-fetch.ts (response bodies are inherently
      // `any` until a Zod parse). Mute the series — they hide the bugs that
      // matter (floating promises, misused promises, hook-deps).
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/restrict-template-expressions': 'off',
      '@typescript-eslint/no-base-to-string': 'off',
    },
  },
)
