/* eslint-disable */
// Local shim for internal dev: satisfy imports like `import { AntiMEV } from '@kestrel-protocol/edge'`.
// Narrow, non-invasive types (any) to keep a focused strict pass; replace with proper types in a later pass.
declare module '@kestrel-protocol/edge' {
  export type BundleAssembler = any;
  export type RelayRouter = any;
  export type InclusionPredictor = any;
  export type AntiMEV = any;
  export type CapitalPolicy = any;
}

// Shims for public SDK types (when not installed)
declare module '@kestrel-hq/protocol-sdk/edge/interfaces/BundleAssembler' {
  export type BundleAssembler = any;
}
declare module '@kestrel-hq/protocol-sdk/edge/interfaces/RelayRouter' {
  export type RelayRouter = any;
}
declare module '@kestrel-hq/protocol-sdk/edge/interfaces/InclusionPredictor' {
  export type InclusionPredictor = any;
}

// Jest globals for test files
declare global {
  function describe(description: string, fn: () => void): void;
  function it(description: string, fn: () => void): void;
  namespace expect {
    function toBeDefined(): void;
  }
}
