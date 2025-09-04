// src/config.ts

/**
 * Centralized configuration module for environment variables and constants.
 */

export const ENV = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: process.env.PORT ? Number(process.env.PORT) : 3000,
  RPC_URL: process.env.RPC_URL || 'http://127.0.0.1:8545',
  API_SERVER_PORT: process.env.API_SERVER_PORT ? Number(process.env.API_SERVER_PORT) : 4000,
  ARB_SENTINEL: process.env.ARB_SENTINEL || ''
  // Add more environment variables as needed
}

export const CONSTANTS = {
  APP_NAME: 'Kestrel Protocol',
  // Add more constants as needed
}
