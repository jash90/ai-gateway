module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: 'tsconfig.json',
    tsconfigRootDir : __dirname, 
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint/eslint-plugin'],
  extends: [
    'plugin:@typescript-eslint/recommended',
    // 'plugin:prettier/recommended' was previously listed but the codebase
    // never matched its defaults (no-semicolons + single quotes vs prettier's
    // semicolons + double quotes), so 2k+ false errors masked real ones.
    // Re-enable once a `.prettierrc` is committed and the codebase is run
    // through `prettier --write`.
  ],
  root: true,
  env: {
    node: true,
    jest: true,
  },
  // Mirror tsconfig.json's `exclude` — these modules are legacy / disabled
  // during the BE-S1-002 hard cutover and will be rebuilt in their sprints.
  // ESLint with parserOptions.project fails on files the tsconfig doesn't see.
  ignorePatterns: [
    '.eslintrc.js',
    'src/modules/jobs/**',
    'src/modules/proxy/**',
    'src/modules/usage/**',
    'src/common/guards/api-key.guard.ts',
  ],
  rules: {
    '@typescript-eslint/interface-name-prefix': 'off',
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/no-explicit-any': 'off',
    // Surface unhandled async work — common cause of "I clicked the button,
    // nothing happened, no error in logs". `void expr;` is the documented
    // intentional-fire-and-forget escape hatch.
    '@typescript-eslint/no-floating-promises': 'error',
  },
};
