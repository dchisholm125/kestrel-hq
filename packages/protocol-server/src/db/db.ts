// Use a dynamic require for pg-promise to avoid strict type dependency in this lightweight repo
// When building for production, install `pg-promise` and its types.
const pgPromise: any = (() => {
	try {
		// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
		return require('pg-promise')
	} catch (e) {
		return null
	}
})()
import { ENV } from '../config.js'

const connection = process.env.DATABASE_URL || 'postgres://localhost/kestrel'
export const db: any = pgPromise ? pgPromise()(connection) : {
	// lightweight fallback stubs for local dev: tx executes the function synchronously against a mock
	tx: async (fn: Function) => {
		// simple in-memory stub that throws to indicate unavailable DB
		throw new Error('db_unavailable')
	}
}
