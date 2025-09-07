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

let realDb: any = null
let triedInit = false

async function initDb() {
	if (realDb || triedInit) return realDb
	triedInit = true
	// diagnostic: trace why DB init is happening during tests
	// eslint-disable-next-line no-console
	console.debug('[db] initDb called, stack:\n', new Error().stack)
	if (!pgPromise) return null
	try {
		realDb = pgPromise()(connection)
	} catch (e) {
		// eslint-disable-next-line no-console
		console.warn('[db] lazy pg-promise init failed, continuing with stub:', (e as any)?.message || e)
		realDb = null
	}
	return realDb
}

export const db: any = {
	tx: async (fn: Function) => {
		// attempt to lazily initialize the real DB once
		const r = await initDb()
		if (!r) {
			throw new Error('db_unavailable')
		}
		return r.tx(fn)
	}
}
