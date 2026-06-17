// Crypto utilities using Web Crypto API (native in Cloudflare Workers).

const encoder = new TextEncoder()
const decoder = new TextDecoder()

// ---- Password hashing (PBKDF2) ----

export async function hashPassword(password: string): Promise<string> {
  const salt = new Uint8Array(16)
  crypto.getRandomValues(salt)
  const key = await crypto.subtle.importKey("raw", encoder.encode(password) as BufferSource, "PBKDF2", false, ["deriveBits"])
  const derived = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: 100_000, hash: "SHA-256" },
    key, 256,
  )
  return `${bytesToHex(salt)}:${bytesToHex(new Uint8Array(derived))}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(":")
  if (!saltHex || !hashHex) return false
  const salt = hexToBytes(saltHex)
  const key = await crypto.subtle.importKey("raw", encoder.encode(password) as BufferSource, "PBKDF2", false, ["deriveBits"])
  const derived = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: 100_000, hash: "SHA-256" },
    key, 256,
  )
  return bytesToHex(new Uint8Array(derived)) === hashHex
}

// ---- Random tokens ----

export function generateRefreshToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return bytesToBase64url(bytes)
}

// ---- JWT ----

export async function signJWT(payload: Record<string, unknown>, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret) as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
  const header = bytesToBase64url(encoder.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })))
  const body = bytesToBase64url(encoder.encode(JSON.stringify({
    ...payload,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 7200,
  })))
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(`${header}.${body}`) as BufferSource)
  return `${header}.${body}.${bytesToBase64url(new Uint8Array(sig))}`
}

export async function verifyJWT(token: string, secret: string): Promise<Record<string, unknown> | null> {
  const parts = token.split(".")
  if (parts.length !== 3) return null
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret) as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["verify"])
  const valid = await crypto.subtle.verify("HMAC", key,
    base64urlToBytes(parts[2]) as BufferSource,
    encoder.encode(`${parts[0]}.${parts[1]}`) as BufferSource)
  if (!valid) return null
  try {
    const payload = JSON.parse(decoder.decode(base64urlToBytes(parts[1])))
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null
    return payload
  } catch { return null }
}

// ---- Helpers ----

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return bytes
}

function bytesToBase64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function base64urlToBytes(str: string): Uint8Array {
  const base64 = str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice(0, (4 - str.length % 4) % 4)
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
}
