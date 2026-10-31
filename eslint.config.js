import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

/**
 * Flat config. The rule that matters most here is the purity guard on the contract
 * package (protocol/ts): it may not reach for electron, react, or the DOM. If that rule
 * fires, fix the import, never the rule.
 */
const PURE_PACKAGES = ['protocol/ts/**/*.ts'];

const PURITY_PATHS = [
  {
    name: 'electron',
    message: 'protocol/ts must stay host-agnostic.',
  },
  {
    name: 'react',
    message: 'protocol/ts must stay UI-agnostic.',
  },
  {
    name: 'react-dom',
    message: 'protocol/ts must stay UI-agnostic.',
  },
];

// A rule's options are replaced, not merged, by a later block, so the one block per file set
// below spells out every ban it needs from these lists.
const PURITY_PATTERNS = [
  {
    group: ['electron/*', 'electron-*'],
    message: 'protocol/ts must stay host-agnostic.',
  },
  {
    group: ['react/*', 'react-dom/*'],
    message: 'protocol/ts must stay UI-agnostic.',
  },
  {
    group: ['@tagalong/*'],
    message: 'protocol/ts sits at the bottom of the dependency graph.',
  },
];

const NO_NODE_BUILTINS = {
  group: ['node:*'],
  message: 'protocol/ts depends on zod and nothing else.',
};

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
      'no-restricted-imports': [
        'error',
        { paths: PURITY_PATHS, patterns: [...PURITY_PATTERNS, NO_NODE_BUILTINS] },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'window', message: 'No DOM globals in protocol/ts.' },
        { name: 'document', message: 'No DOM globals in protocol/ts.' },
        { name: 'navigator', message: 'No DOM globals in protocol/ts.' },
        { name: 'localStorage', message: 'No DOM globals in protocol/ts.' },
      ],
    },
  },
  {
    // The examples test reads the sample files, so tests alone may import node:fs, node:path
    // and node:url; every other ban still applies.
    files: ['protocol/ts/**/*.test.ts'],
    rules: {
      'no-restricted-imports': ['error', { paths: PURITY_PATHS, patterns: PURITY_PATTERNS }],
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
    // Desktop main and the voice process import these, so no React may sneak in.
    // They also run in node, so no DOM globals, and they stay inside their folder.
    files: ['bodies/ui/src/shapes/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'react', message: '@tagalong/ui/shapes must stay React-free.' },
            { name: 'react-dom', message: '@tagalong/ui/shapes must stay React-free.' },
          ],
          patterns: [
            {
              group: ['react/*', 'react-dom/*'],
              message: '@tagalong/ui/shapes must stay React-free.',
            },
            {
              group: ['../*'],
              message: '@tagalong/ui/shapes must not import out of its folder.',
            },
          ],
        },
      ],
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
