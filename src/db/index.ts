import type { D1Database } from "@cloudflare/workers-types"

let db: D1Database

export function getDB(): D1Database {
  if (!db) throw new Error("DB not initialized. Call initDB(env.DB) first.")
  return db
}

export function initDB(d1: D1Database) {
  db = d1
}

// Helper: generate a random ID (cuid-like)
export function uid(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
}
