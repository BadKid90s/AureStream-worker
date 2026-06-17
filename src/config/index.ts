import type { D1Database } from "@cloudflare/workers-types"

export interface Env {
  DB: D1Database
  JWT_SECRET: string
}

export interface AppVariables {
  userId: string
  userEmail: string
}

export const ACCESS_TOKEN_EXPIRES_IN = 7200        // 2 hours (seconds)
export const REFRESH_TOKEN_EXPIRES_IN = 30 * 24 * 3600 // 30 days (seconds)
