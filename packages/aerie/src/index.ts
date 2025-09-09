/**
 * Kestrel Aerie SDK public surface.
 * Scanner and trading helpers for on-chain opportunities.
 */
export { OnChainScanner } from './OnChainScanner';
export { OpportunityIdentifier, type Opportunity, type CandidateArb } from './OpportunityIdentifier';
export { TradeCrafter } from './TradeCrafter';
export { PriceMonitor, type TriangularArbitrageOpportunity } from './PriceMonitor';
export { KestrelSubmitter, KestrelSubmitterError } from './KestrelSubmitter';
export { Logger } from './utils/logger';
