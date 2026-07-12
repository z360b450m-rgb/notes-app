import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import pluginVue from 'eslint-plugin-vue'
import vueParser from 'vue-eslint-parser'
import prettierConfig from 'eslint-config-prettier'
import globals from 'globals'

export default [
  // Global ignores
  {
    ignores: [
      'dist/**',
      'dist-electron/**',
      'node_modules/**',
      'public/**',
      '.vscode/**',
      '.vs/**',
      '*.min.js',
      '*.min.css',
    ],
  },

  // ===== Browser TypeScript (src/*.ts, no .vue) =====
  {
    files: ['src/**/*.ts'],
    plugins: {
      '@typescript-eslint': tseslint.plugin,
    },
    languageOptions: {
      ecmaVersion: 2020,
      parser: tseslint.parser,
      globals: { ...globals.browser },
    },
    rules: {
      ...js.configs.recommended.rules,
      ...tseslint.configs.recommended.reduce((acc, c) => ({ ...acc, ...c.rules }), {}),
      ...prettierConfig.rules,
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },

  // ===== Vue SFC =====
  {
    files: ['src/**/*.vue'],
    plugins: {
      vue: pluginVue,
      '@typescript-eslint': tseslint.plugin,
    },
    languageOptions: {
      ecmaVersion: 2020,
      parser: vueParser,
      parserOptions: {
        parser: tseslint.parser,
        ecmaVersion: 2020,
        sourceType: 'module',
      },
      globals: { ...globals.browser },
    },
    rules: {
      ...js.configs.recommended.rules,
      ...tseslint.configs.recommended.reduce((acc, c) => ({ ...acc, ...c.rules }), {}),
      ...pluginVue.configs['flat/essential'].rules,
      ...prettierConfig.rules,
      'vue/multi-word-component-names': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },

  // ===== Type declaration files =====
  {
    files: ['src/**/*.d.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
    },
  },

  // ===== Electron main (CJS) =====
  {
    files: ['electron/**/*.cjs'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: { ...globals.node },
    },
    rules: {
      ...js.configs.recommended.rules,
      ...prettierConfig.rules,
    },
  },

  // ===== Service Worker =====
  {
    files: ['sw.js', 'public/**/*.js'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: { ...globals.serviceworker },
    },
    rules: {
      ...js.configs.recommended.rules,
      ...prettierConfig.rules,
    },
  },

  // ===== Node config files =====
  {
    files: ['*.config.{js,ts}', 'eslint.config.js', 'postcss.config.js'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
]
