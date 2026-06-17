import { Hono } from "hono"
import type { Env, AppVariables } from "../config/index.js"

export const authRouter = new Hono<{ Bindings: Env; Variables: AppVariables }>()

import { z } from "zod"
import {
  hashPassword,
  verifyPassword,
  generateRefreshToken,
  signJWT,
} from "../utils/crypto.js"
import { getDB, uid } from "../db/index.js"
import { REFRESH_TOKEN_EXPIRES_IN, ACCESS_TOKEN_EXPIRES_IN } from "../config/index.js"

// POST /auth/register
authRouter.post("/register", async (c) => {
  const body = await c.req.json()
  const parsed = z.object({
    email: z.string().email(),
    password: z.string().min(6),
  }).safeParse(body)

  if (!parsed.success) {
    return c.json({ error: "invalid_request", details: parsed.error.issues }, 400)
  }

  const { email, password } = parsed.data
  const db = getDB()

  const existing = await db.prepare("SELECT id FROM users WHERE email = ?").bind(email).first()
  if (existing) {
    return c.json({ error: "email_already_registered" }, 409)
  }

  const id = uid()
  const passwordHash = await hashPassword(password)
  const now = Math.floor(Date.now() / 1000)

  await db.prepare(
    "INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)"
  ).bind(id, email, passwordHash, now).run()

  // Issue tokens immediately after registration
  const secret = c.env.JWT_SECRET
  const accessToken = await signJWT({ sub: id, email }, secret)
  const refreshToken = generateRefreshToken()
  const refreshExpires = now + REFRESH_TOKEN_EXPIRES_IN

  await db.prepare(
    "INSERT INTO refresh_tokens (token, user_id, expires_at) VALUES (?, ?, ?)"
  ).bind(refreshToken, id, refreshExpires).run()

  return c.json({
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: ACCESS_TOKEN_EXPIRES_IN,
    user: { id, email, created_at: now },
  }, 201)
})

// POST /auth/login
authRouter.post("/login", async (c) => {
  const body = await c.req.json()
  const parsed = z.object({
    email: z.string().email(),
    password: z.string().min(1),
  }).safeParse(body)

  if (!parsed.success) {
    return c.json({ error: "invalid_request", details: parsed.error.issues }, 400)
  }

  const { email, password } = parsed.data
  const db = getDB()
  const now = Math.floor(Date.now() / 1000)

  const user = await db.prepare(
    "SELECT id, email, password_hash, created_at FROM users WHERE email = ?"
  ).bind(email).first<{ id: string; email: string; password_hash: string; created_at: number }>()

  if (!user) {
    return c.json({ error: "invalid_credentials" }, 401)
  }

  const valid = await verifyPassword(password, user.password_hash)
  if (!valid) {
    return c.json({ error: "invalid_credentials" }, 401)
  }

  const secret = c.env.JWT_SECRET
  const accessToken = await signJWT({ sub: user.id, email: user.email }, secret)
  const refreshToken = generateRefreshToken()
  const refreshExpires = now + REFRESH_TOKEN_EXPIRES_IN

  await db.prepare(
    "INSERT INTO refresh_tokens (token, user_id, expires_at) VALUES (?, ?, ?)"
  ).bind(refreshToken, user.id, refreshExpires).run()

  return c.json({
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: ACCESS_TOKEN_EXPIRES_IN,
    user: { id: user.id, email: user.email, created_at: user.created_at },
  })
})

// POST /auth/refresh
authRouter.post("/refresh", async (c) => {
  const body = await c.req.json()
  const parsed = z.object({
    refresh_token: z.string().min(1),
  }).safeParse(body)

  if (!parsed.success) {
    return c.json({ error: "invalid_request" }, 400)
  }

  const { refresh_token } = parsed.data
  const db = getDB()
  const now = Math.floor(Date.now() / 1000)

  const rt = await db.prepare(
    "SELECT token, user_id, expires_at FROM refresh_tokens WHERE token = ?"
  ).bind(refresh_token).first<{ token: string; user_id: string; expires_at: number }>()

  if (!rt || rt.expires_at < now) {
    return c.json({ error: "invalid_token" }, 401)
  }

  const user = await db.prepare(
    "SELECT id, email, created_at FROM users WHERE id = ?"
  ).bind(rt.user_id).first<{ id: string; email: string; created_at: number }>()

  if (!user) {
    return c.json({ error: "invalid_token" }, 401)
  }

  // Rotate refresh token
  await db.prepare("DELETE FROM refresh_tokens WHERE token = ?").bind(refresh_token).run()

  const secret = c.env.JWT_SECRET
  const newRefreshToken = generateRefreshToken()
  const newExpires = now + REFRESH_TOKEN_EXPIRES_IN
  await db.prepare(
    "INSERT INTO refresh_tokens (token, user_id, expires_at) VALUES (?, ?, ?)"
  ).bind(newRefreshToken, user.id, newExpires).run()

  const accessToken = await signJWT({ sub: user.id, email: user.email }, secret)

  return c.json({
    access_token: accessToken,
    refresh_token: newRefreshToken,
    expires_in: ACCESS_TOKEN_EXPIRES_IN,
  })
})

// POST /auth/logout
authRouter.post("/logout", async (c) => {
  const body = await c.req.json()
  const parsed = z.object({
    refresh_token: z.string().min(1),
  }).safeParse(body)

  if (!parsed.success) {
    return c.json({ error: "invalid_request" }, 400)
  }

  const db = getDB()
  await db.prepare("DELETE FROM refresh_tokens WHERE token = ?").bind(parsed.data.refresh_token).run()

  return c.body(null, 204)
})
