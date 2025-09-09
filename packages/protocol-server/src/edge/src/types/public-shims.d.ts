// Only for local development when @kestrel-hq/* is not resolvable.
// Replace by installing the real public packages.
declare module '@kestrel-hq/protocol-sdk/edge/interfaces/BundleAssembler' { export type BundleAssembler = unknown }
declare module '@kestrel-hq/protocol-sdk/edge/interfaces/RelayRouter' { export type RelayRouter = unknown }
declare module '@kestrel-hq/protocol-sdk/edge/interfaces/InclusionPredictor' { export type InclusionPredictor = unknown }
declare module '@kestrel-hq/protocol-sdk/edge/interfaces/AntiMEV' { export type AntiMEV = unknown }
declare module '@kestrel-hq/protocol-sdk/edge/interfaces/CapitalPolicy' { export type CapitalPolicy = unknown }
