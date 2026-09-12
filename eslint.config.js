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
const PURE_PACKAGES = ['packages/core/**/*.ts', 'packages/protocol/**/*.ts'];

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/out/**', '**/coverage/**', '**/node_modules/**', '.remember/**'],
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
        {
          paths: [
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
          ],
          patterns: [
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
          ],
        },
      ],
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
    files: ['packages/protocol/**/*.ts'],
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
    files: ['packages/ui/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      globals: { ...globals.browser },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },
  {
    files: ['apps/extension/**/*.ts'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.webextensions },
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
