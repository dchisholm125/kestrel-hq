module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint', 'import'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  rules: {
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    'import/no-unused-modules': ['warn', { unusedExports: true, missingExports: true, ignoreExports: ['**/dist/**'] }],
  },
  ignorePatterns: ['**/dist/**', '**/node_modules/**', '**/reports/**']
}
