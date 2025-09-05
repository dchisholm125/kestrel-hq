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
  const envVars = envContent.split('\n').filter(line => line.includes('='))
  envVars.forEach(line => {
    const [key, value] = line.split('=')
    if (key && value) {
      process.env[key] = value
    }
  })
}

export const ENV = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: process.env.PORT ? Number(process.env.PORT) : 3000,
  RPC_URL: process.env.RPC_URL || 'http://127.0.0.1:8545',
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
  ARB_SENTINEL: process.env.ARB_SENTINEL || '',
  FLASHBOTS_RELAY_URL: process.env.FLASHBOTS_RELAY_URL || 'https://relay.flashbots.net',
  FLASHBOTS_SIGNING_KEY: process.env.FLASHBOTS_SIGNING_KEY || '',
  BLOXROUTE_RELAY_URL: process.env.BLOXROUTE_RELAY_URL || 'https://blox.example',
  BLOXROUTE_AUTH: process.env.BLOXROUTE_AUTH || ''
  // Add more environment variables as needed
}

export const CONSTANTS = {
  APP_NAME: 'Kestrel Protocol',
  // Add more constants as needed
}
