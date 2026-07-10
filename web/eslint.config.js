import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'node_modules'] },

  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  // F-001 REQ-F001-044 (i)-(iii), ruling 1 (2026-07-09): the JS/TS raw-literal adherence floor.
  // oxlint 1.73 has no `no-restricted-syntax`, so the DS gate's raw-hex / raw-px / off-system
  // font-family rules are enforced here, in ESLint, over `web/src/**` JS/TS/JSX (e.g. inline
  // `style={{…}}` objects). This block is invoked as part of `npm run lint:ds` (see package.json),
  // which must exit non-zero on ANY violation. The DS token layer is `.css` (never scanned by ESLint),
  // and the recreated DS components resolve color/length through `var()` in CSS modules, so nothing in
  // the token layer is falsely flagged.
  {
    files: ['src/**/*.{ts,tsx,js,jsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          // (i) no raw hex color literals
          selector: 'Literal[value=/#[0-9a-fA-F]{3,8}\\b/]',
          message:
            'REQ-F001-044(i): no raw hex color literal in JS/TS — use a DS color token via var(--theme-*) / var(--alm-*) in CSS.',
        },
        {
          selector: 'TemplateElement[value.raw=/#[0-9a-fA-F]{3,8}\\b/]',
          message:
            'REQ-F001-044(i): no raw hex color literal in JS/TS — use a DS color token via var(--theme-*) / var(--alm-*) in CSS.',
        },
        {
          // (ii) no raw px length literals
          selector: 'Literal[value=/[0-9]px\\b/]',
          message:
            'REQ-F001-044(ii): no raw px length literal in JS/TS — use a DS spacing token via var(--space-*) in CSS.',
        },
        {
          selector: 'TemplateElement[value.raw=/[0-9]px\\b/]',
          message:
            'REQ-F001-044(ii): no raw px length literal in JS/TS — use a DS spacing token via var(--space-*) in CSS.',
        },
        {
          // (iii) no off-system font-family (anything other than the DS Plus Jakarta Sans / --font token)
          selector:
            'Property[key.name="fontFamily"] > Literal[value!=/Plus Jakarta Sans/][value!=/var\\(--font/]',
          message:
            'REQ-F001-044(iii): off-system font-family — the DS font is "Plus Jakarta Sans" (use var(--font-*)).',
        },
      ],
    },
  },

  {
    files: ['**/*.test.{ts,tsx}', 'src/test/**'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },

  {
    files: ['*.config.{js,ts}', 'vite.config.ts'],
    languageOptions: { globals: globals.node },
  },

  prettier,
);
