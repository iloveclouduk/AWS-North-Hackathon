// Lint for the extension (src/, scripts/, tests/). The server and infra keep their own strict tsc settings; this adds
// what tsc can't see: the rules of hooks and accessibility in the React UI.
import js from '@eslint/js';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // tests/fixtures holds pages and scripts the tests load as-is (a copy of a console page's widgets).
  { ignores: ['.output/**', '.wxt/**', '.cache/**', 'node_modules/**', 'server/**', 'infra/**', 'parked/**', 'agentic-city/**', 'public/**', 'backend/**', '.claude/**', 'tests/fixtures/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}', 'tests/**/*.{ts,tsx}', 'scripts/**/*.{js,mjs,ts}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node, ...globals.webextensions } },
    rules: {
      // `_x` marks an argument kept on purpose (a handler's signature, a destructured field left out).
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true }],
      // `cond && run()` and comma sequences (`place(p), n++`) are idioms here; tsc already rejects a truly useless line.
      '@typescript-eslint/no-unused-expressions': 'off',
      // Stacked cases with a comment between them are one group, not a fall-through.
      'no-fallthrough': ['error', { allowEmptyCase: true }],
    },
  },
  {
    // Terminal output is matched by its ANSI escape codes on purpose (the launcher scripts say so line by line).
    files: ['tests/**/*.ts'],
    rules: { 'no-control-regex': 'off' },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    files: ['src/**/*.tsx'],
    plugins: { 'jsx-a11y': jsxA11y },
    rules: {
      ...jsxA11y.flatConfigs.recommended.rules,
      // The game canvas and a few cards take focus on purpose (a dialog's first control, the tab panel).
      'jsx-a11y/no-autofocus': 'off',
    },
  },
);
