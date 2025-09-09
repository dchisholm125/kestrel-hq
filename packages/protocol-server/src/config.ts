// src/config.ts

/**
 * Centralized configuration module for environment variables and constants.
 */

// Load environment variables from .env.protocol-server file
import dotenv from 'dotenv'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Resolve package root for both ts-node (src) and built (dist/...) layouts
const distMarker = `${path.sep}dist${path.sep}`
const distIdx = __dirname.lastIndexOf(distMarker)
const packageRoot = distIdx !== -1 ? __dirname.slice(0, distIdx) : path.resolve(__dirname, '..')

// Try to load .env.protocol-server from package root, with cwd fallback
const candidateEnvPaths = [
  path.join(packageRoot, '.env.protocol-server'),
  path.join(process.cwd(), '.env.protocol-server')
]
for (const p of candidateEnvPaths) {
  if (fs.existsSync(p)) {
    dotenv.config({ path: p })
    break
  }
}

// Load private environment variables from kestrel-protocol-private
const privateEnvPath = '/home/ubuntu/Kestrel-root/kestrel-protocol-private/.env.kestrel-protocol-private';
if (fs.existsSync(privateEnvPath)) {
  dotenv.config({ path: privateEnvPath });
}

// Set derived env vars from private keys
if (process.env.SIGNER_PK) {
  const pk = process.env.SIGNER_PK.startsWith('0x') ? process.env.SIGNER_PK : '0x' + process.env.SIGNER_PK;
  process.env.PUBLIC_SUBMIT_PRIVATE_KEY_SEPOLIA = pk;
  process.env.PUBLIC_SUBMIT_PRIVATE_KEY = pk;
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
  CHAIN_ID: process.env.SEPOLIA_SWITCH === '1'
    ? (process.env.SEPOLIA_CHAIN_ID ? Number(process.env.SEPOLIA_CHAIN_ID) : 11155111)
    : (process.env.MAINNET_CHAIN_ID ? Number(process.env.MAINNET_CHAIN_ID) : 1),

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
  FLASHBOTS_SIGNING_KEY: process.env.SEPOLIA_SWITCH === '1'
    ? (process.env.FLASHBOTS_SEPOLIA_SIGNING_KEY || '')
    : (process.env.FLASHBOTS_MAINNET_KEY || process.env.FLASHBOTS_MAINNET_SIGNING_KEY || ''),

  // BloXroute configuration - use appropriate relay based on SEPOLIA_SWITCH
  BLOXROUTE_RELAY_URL: process.env.SEPOLIA_SWITCH === '1'
    ? (process.env.BLOXROUTE_RELAY_SEPOLIA_HTTP_URL || 'https://virginia-intents.blxrbdn.com')
    : (process.env.BLOXROUTE_RELAY_MAINNET_HTTP_URL || 'https://virginia-mainnet.blxrbdn.com'),
  BLOXROUTE_AUTH: process.env.SEPOLIA_SWITCH === '1'
    ? (process.env.BLOXROUTE_SEPOLIA_AUTH_HEADER || process.env.BLOXROUTE_SEPOLIA_AUTH || '')
    : (process.env.BLOXROUTE_MAINNET_AUTH_HEADER || process.env.BLOXROUTE_MAINNET_AUTH || ''),

  // Additional bloXroute gRPC endpoints
  BLOXROUTE_GRPC_ENDPOINT: process.env.SEPOLIA_SWITCH === '1'
    ? (process.env.BLOXROUTE_SEPOLIA_gRPC || 'virginia-intents.blxrbdn.com:5005')
    : (process.env.BLOXROUTE_MAINNET_gRPC || 'virginia-mainnet.blxrbdn.com:5005')
  ,

  // Public mempool submission signer (used only for testnets like Sepolia when we need to self-sign)
  PUBLIC_SUBMIT_PRIVATE_KEY: process.env.SEPOLIA_SWITCH === '1'
    ? (process.env.PUBLIC_SUBMIT_PRIVATE_KEY_SEPOLIA || '')
    : (process.env.PUBLIC_SUBMIT_PRIVATE_KEY || '')
}

export const CONSTANTS = {
  APP_NAME: 'Kestrel Protocol',
  // Add more constants as needed
}
