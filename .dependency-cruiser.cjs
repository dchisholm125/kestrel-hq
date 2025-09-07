/**
 * dependency-cruiser config
 * Flags: unused or orphan modules, forbidden types, circulars.
 */
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  options: {
    doNotFollow: { path: 'node_modules' },
    includeOnly: '^packages',
    exclude: '(/dist/|/test/|/__tests__/|/node_modules/)',
    tsPreCompilationDeps: true,
  },
  forbidden: [
    { name: 'no-circular', severity: 'warn', from: {}, to: { circular: true } },
    { name: 'no-orphans', severity: 'warn', from: { orphan: true }, to: {} },
  ],
}
