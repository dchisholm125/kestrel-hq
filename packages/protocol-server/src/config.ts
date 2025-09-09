// src/config.ts

/**
 * Centralized configuration module for environment variables and constants.
 */

// Load environment variables from .env file if it exists
import fs from 'fs'
import path from 'path'

const envPath = path.join(process.cwd(), 'src', '.env')
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8')
  const envVars = envContent.split('\n').filter((line: string) => line.includes('='))
  envVars.forEach((line: string) => {
    const [key, value] = line.split('=')
    if (key && value) {
      process.env[key] = value
    }
  })
}

export const ENV = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: process.env.PORT ? Number(process.env.PORT) : 3000,
  RPC_URL: process.env.RPC_URL || '',
  // Optional multi-endpoint RPC URLs (supporting new NodeConnector + MultiRpc)
  INFURA_RPC_URL: process.env.INFURA_RPC_URL || '',
  ALCHEMY_RPC_URL: process.env.ALCHEMY_RPC_URL || '',
  QUICKNODE_RPC_URL: process.env.QUICKNODE_RPC_URL || '',
  ANVIL_RPC_URL: process.env.ANVIL_RPC_URL || '',
  INFURA_WS_URL: process.env.INFURA_WS_URL || '',
  ALCHEMY_WS_URL: process.env.ALCHEMY_WS_URL || '',
  QUICKNODE_WS_URL: process.env.QUICKNODE_WS_URL || '',
  WS_RPC_URL: process.env.WS_RPC_URL || '',
  API_SERVER_PORT: process.env.API_SERVER_PORT ? Number(process.env.API_SERVER_PORT) : 4000,
  SKIP_SIGNATURE_CHECK: process.env.SKIP_SIGNATURE_CHECK === '1' || process.env.SKIP_SIGNATURE_CHECK === 'true',
  API_SECRET: process.env.API_SECRET || '',
  ARB_SENTINEL: process.env.ARB_SENTINEL || '',

  // Sepolia switch for testnet vs mainnet
  SEPOLIA_SWITCH: process.env.SEPOLIA_SWITCH === '1',

  // Submission mode: 'bundle' (private), 'public' (mempool), or 'normal' (auto)
  SUBMISSION_MODE: process.env.SUBMISSION_MODE || 'normal',

  // Mock mode for testing - VERY EXPLICIT
  SUBMIT_MOCK: process.env.SUBMIT_MOCK === 'true',

  // Chain ID for network detection
  CHAIN_ID: process.env.CHAIN_ID ? Number(process.env.CHAIN_ID) : (process.env.SEPOLIA_SWITCH === '1' ? 11155111 : 1),

  // Mainnet relay URLs
  FLASHBOTS_MAINNET: process.env.FLASHBOTS_MAINNET || 'https://relay.flashbots.net',
  BEAVER_MAINNET: process.env.BEAVER_MAINNET || '',

  // Sepolia relay URLs (limited support)
  FLASHBOTS_SEPOLIA: process.env.FLASHBOTS_SEPOLIA || 'https://relay-sepolia.flashbots.net',
  BEAVER_SEPOLIA: process.env.BEAVER_SEPOLIA || '',

  // Flashbots configuration - use appropriate relay based on SEPOLIA_SWITCH
  FLASHBOTS_RELAY_URL: process.env.SEPOLIA_SWITCH === '1'
    ? (process.env.SEPOLIA_FLASHBOTS_RELAY || 'https://relay-sepolia.flashbots.net')
    : (process.env.FLASHBOTS_ENDPOINT || 'https://relay.flashbots.net'),
  FLASHBOTS_SIGNING_KEY: process.env.FLASHBOTS_KEY || process.env.FLASHBOTS_SIGNING_KEY || '',

  // BloXroute configuration - use appropriate relay based on SEPOLIA_SWITCH
  BLOXROUTE_RELAY_URL: process.env.SEPOLIA_SWITCH === '1'
    ? (process.env.BLOXROUTE_RELAY_SEPOLIA_WS_URL || 'wss://virginia-intents.blxrbdn.com/ws')
    : (process.env.BLOXROUTE_RELAY_MAINNET_WS_URL || 'wss://virginia-mainnet.blxrbdn.com/ws'),
  BLOXROUTE_AUTH: process.env.BLOXROUTE_AUTH_HEADER || process.env.BLOXROUTE_AUTH || '',

  // Additional bloXroute gRPC endpoints
  BLOXROUTE_GRPC_ENDPOINT: process.env.SEPOLIA_SWITCH === '1'
    ? (process.env.BLOXROUTE_SEPOLIA_gRPC || 'virginia-intents.blxrbdn.com:5005')
    : (process.env.BLOXROUTE_MAINNET_gRPC || 'virginia-mainnet.blxrbdn.com:5005')
}

export const CONSTANTS = {
  APP_NAME: 'Kestrel Protocol',
  // Add more constants as needed
}
