/** @type {import('jest').Config} */
module.exports = {
	preset: 'ts-jest',
	testEnvironment: 'node',
	moduleFileExtensions: ['ts', 'js', 'json', 'node'],
	transform: {
		'^.+\\.(ts|tsx)$': 'ts-jest'
	},
	moduleNameMapper: {
		'^@kestrel/reasons$': '<rootDir>/../reasons/src/index.ts',
		'^@kestrel/reasons/(.*)$': '<rootDir>/../reasons/src/$1',
		'^@kestrel/dto$': '<rootDir>/../dto/src/index.ts',
		'^@kestrel/math$': '<rootDir>/../math/src/index.ts'
	},
	testPathIgnorePatterns: ['/node_modules/', '/dist/', '/test/integration/'],
	// No aggressive moduleNameMapper to avoid remapping node_modules; shims added for local .js imports used by src
	testMatch: ['**/test/**/*.test.ts']
}
