module.exports = {
  env: {
    node: true,
    browser: true,
    es2022: true,
  },
  extends: ['eslint:recommended'],
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  rules: {
    // Code quality
    'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    'no-console': 'off', // Console is fine in a desktop/server app
    'no-var': 'error',
    'prefer-const': 'warn',

    // Style
    'semi': ['error', 'always'],
    'quotes': ['error', 'single', { avoidEscape: true }],
    'comma-dangle': ['error', 'always-multiline'],
    'indent': ['error', 2, { SwitchCase: 1 }],
    'eol-last': ['error', 'always'],
    'no-trailing-spaces': 'error',
    'object-curly-spacing': ['error', 'always'],
    'arrow-spacing': 'error',
    'keyword-spacing': 'error',
    'space-before-blocks': 'error',
  },
  overrides: [
    {
      // Electron main process — Node.js only, no browser globals
      files: ['electron/**/*.js'],
      env: {
        browser: false,
        node: true,
      },
    },
    {
      // Frontend — browser only, no Node.js globals
      files: ['frontend/**/*.js'],
      env: {
        browser: true,
        node: false,
      },
    },
  ],
};
