module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleFileExtensions: ['ts', 'js', 'json', 'node'],
  transform: {
    '^.+\\.(ts|tsx)$': 'ts-jest'
  },
  // No aggressive moduleNameMapper to avoid remapping node_modules; shims added for local .js imports used by src
  testMatch: ['**/test/**/*.test.ts']
}
