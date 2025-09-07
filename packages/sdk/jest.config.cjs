module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/test/**/*.test.ts'],
  moduleNameMapper: {
  '^@kestrel/dto$': '<rootDir>/../dto/src/index.ts',
  '^@kestrel/math$': '<rootDir>/../math/src/index.ts'
  }
}
