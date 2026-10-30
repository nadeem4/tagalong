import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

/**
 * Flat config. The rule that matters most here is the purity guard on
 * packages/core and packages/protocol: neither may reach for electron, react,
 * or the DOM. If that rule fires, fix the import, never the rule.
 */
const PURE_PACKAGES = ['packages/core/**/*.ts', 'packages/protocol/**/*.ts', 'protocol/ts/**/*.ts'];

const PURITY_PATHS = [
  {
    name: 'electron',
    message: 'packages/core and packages/protocol must stay host-agnostic.',
  },
  {
    name: 'react',
    message: 'packages/core and packages/protocol must stay UI-agnostic.',
  },
  {
    name: 'react-dom',
    message: 'packages/core and packages/protocol must stay UI-agnostic.',
  },
];

const PURITY_PATTERNS = [
  {
    group: ['electron/*', 'electron-*'],
    message: 'packages/core and packages/protocol must stay host-agnostic.',
  },
  {
    group: ['react/*', 'react-dom/*'],
    message: 'packages/core and packages/protocol must stay UI-agnostic.',
  },
  {
    group: ['@tagalong/ui', '@tagalong/ui/*'],
    message: 'The engine must not depend on the UI package.',
  },
];

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/out/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/.venv/**',
      '**/release/**',
      '.remember/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },
  {
    files: PURE_PACKAGES,
    languageOptions: {
      // No DOM globals in the pure packages: referencing window or document
      // becomes an undefined-variable error rather than a silent pass.
      globals: { ...globals.node },
    },
    rules: {
      'no-restricted-imports': ['error', { paths: PURITY_PATHS, patterns: PURITY_PATTERNS }],
      'no-restricted-globals': [
        'error',
        { name: 'window', message: 'No DOM globals in the engine.' },
        { name: 'document', message: 'No DOM globals in the engine.' },
        { name: 'navigator', message: 'No DOM globals in the engine.' },
        { name: 'localStorage', message: 'No DOM globals in the engine.' },
      ],
    },
  },
  {
    // The runner and engine reach tools through the registry, so there is one place a
    // turn's tools are decided. Repeats the purity lists: a later block replaces a rule's
    // options rather than merging them.
    files: ['packages/core/src/conversation/**/*.ts', 'packages/core/src/engine.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: PURITY_PATHS,
          patterns: [
            ...PURITY_PATTERNS,
            {
              group: ['**/tools/builtin', '**/tools/builtin/**'],
              message: 'Import tools from tools/registry or the tools index, never a built-in.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/protocol/**/*.ts', 'protocol/ts/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'electron', message: 'packages/protocol depends on zod and nothing else.' },
            { name: 'react', message: 'packages/protocol depends on zod and nothing else.' },
          ],
          patterns: [
            { group: ['node:*'], message: 'packages/protocol depends on zod and nothing else.' },
            {
              group: ['@tagalong/*'],
              message: 'packages/protocol sits at the bottom of the dependency graph.',
            },
          ],
        },
      ],
    },
  },
  {
    // The examples test reads the sample files, so tests alone may import node:fs, node:path
    // and node:url. Repeats the other bans: a later block replaces a rule's options.
    files: ['protocol/ts/**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'electron', message: 'protocol/ts depends on zod and nothing else.' },
            { name: 'react', message: 'protocol/ts depends on zod and nothing else.' },
          ],
          patterns: [
            {
              group: ['@tagalong/*'],
              message: 'protocol/ts sits at the bottom of the dependency graph.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['bodies/ui/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      globals: { ...globals.browser },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },
  {
    files: ['bodies/browser/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      globals: { ...globals.browser, ...globals.webextensions },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },
  {
    // Runs on the audio thread, where the worklet's own globals are all there is.
    files: ['bodies/desktop/src/renderer/src/mic-worklet.js'],
    languageOptions: {
      globals: { ...globals.audioWorklet },
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      // Underscore prefix is the documented way to say "deliberately discarded".
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  {
    files: ['**/*.test.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  prettier,
);
