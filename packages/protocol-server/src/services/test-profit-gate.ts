/**
 * Test for ProfitGate functionality
 * This is a simple test to verify the profit calculation logic works correctly.
 */

import { ProfitGate } from './ProfitGate';

// Mock candidate and quote data
const mockCandidate = {
  id: 'test-arb-1',
  amountIn: BigInt('1000000000000000000'), // 1 ETH
  tokenIn: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
  tokenOut: '0xA0b86a33E6441e88C5F2712C3E9b74F6B1c4F2F8',
  chainId: 1,
  source: 'mempool' as const,
  hops: [
    {
      dex: 'V2' as const,
      router: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
      tokenIn: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
      tokenOut: '0xA0b86a33E6441e88C5F2712C3E9b74F6B1c4F2F8',
      fee: 3000
    }
  ]
};

const mockQuote = {
  amountOut: BigInt('1020000000000000000'), // 1.02 ETH (2% profit before costs)
  perHopAmounts: [BigInt('1020000000000000000')],
  gasEstimate: BigInt('200000') // 200k gas
};

// Test the profit calculation
async function testProfitGate() {
  console.log('🧪 Testing ProfitGate functionality...');

  const gate = new ProfitGate();

  // Test 1: Profitable arbitrage
  console.log('\n📊 Test 1: Profitable arbitrage (2% gross profit)');
  const result1 = await gate.checkProfit(mockCandidate, mockQuote, BigInt('200000'), {
    maxFeePerGas: BigInt('50000000000'), // 50 gwei
    maxPriorityFeeGas: BigInt('2000000000'), // 2 gwei
    flashLoanUsed: false
  });

  console.log('✅ Result:', {
    ok: result1.ok,
    profitWei: result1.profitWei.toString(),
    profitEth: result1.profitEth,
    roiBps: result1.roiBps,
    gasCostWei: result1.gasCostWei.toString(),
    totalCostWei: result1.totalCostWei.toString()
  });

  // Test 2: Unprofitable arbitrage (high gas costs)
  console.log('\n📊 Test 2: Unprofitable arbitrage (high gas costs)');
  const result2 = await gate.checkProfit(mockCandidate, mockQuote, BigInt('200000'), {
    maxFeePerGas: BigInt('500000000000'), // 500 gwei (very high)
    maxPriorityFeeGas: BigInt('20000000000'), // 20 gwei
    flashLoanUsed: false
  });

  console.log('❌ Result:', {
    ok: result2.ok,
    profitWei: result2.profitWei.toString(),
    profitEth: result2.profitEth,
    roiBps: result2.roiBps,
    reason: result2.reason
  });

  // Test 3: Flash loan arbitrage
  console.log('\n📊 Test 3: Flash loan arbitrage (with premium)');
  const result3 = await gate.checkProfit(mockCandidate, mockQuote, BigInt('200000'), {
    maxFeePerGas: BigInt('50000000000'), // 50 gwei
    maxPriorityFeeGas: BigInt('2000000000'), // 2 gwei
    flashLoanUsed: true,
    flashPremiumBps: 9 // 0.09%
  });

  console.log('✅ Result:', {
    ok: result3.ok,
    profitWei: result3.profitWei.toString(),
    profitEth: result3.profitEth,
    roiBps: result3.roiBps,
    flashPremiumWei: result3.flashPremiumWei.toString()
  });

  console.log('\n🎉 ProfitGate tests completed!');
}

// Run the test
testProfitGate().catch(console.error);
