/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', { diagnostics: true }],
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
  collectCoverageFrom: ['src/**/*.{ts,js}'],
  coverageDirectory: 'coverage',
  testTimeout: 20000,
  setupFilesAfterEnv: [],
  testPathIgnorePatterns: ['/node_modules/', '/dist/']
};
