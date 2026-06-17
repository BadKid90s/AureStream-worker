import { Hono } from "hono"
import { z } from "zod"
import { requireAuth } from "../middleware/auth.js"
import { getDB } from "../db/index.js"
import { hashPassword, verifyPassword } from "../utils/crypto.js"
import type { Env, AppVariables } from "../config/index.js"

export const userRouter = new Hono<{ Bindings: Env; Variables: AppVariables }>()

// GET /user/me
userRouter.get("/me", requireAuth, async (c) => {
  const userId = c.get("userId")
  const db = getDB()

  const user = await db.prepare(
    "SELECT id, email, created_at FROM users WHERE id = ?"
  ).bind(userId).first<{ id: string; email: string; created_at: number }>()

  if (!user) {
    return c.json({ error: "user_not_found" }, 404)
  }

  return c.json(user)
})

// PUT /user/me  — change password or email
userRouter.put("/me", requireAuth, async (c) => {
  const userId = c.get("userId")
  const body = await c.req.json()
  const parsed = z.object({
    current_password: z.string().min(1).optional(),
    new_password: z.string().min(6).optional(),
    email: z.string().email().optional(),
  }).safeParse(body)

  if (!parsed.success) {
    return c.json({ error: "invalid_request", details: parsed.error.issues }, 400)
  }

  const { current_password, new_password, email } = parsed.data
  const db = getDB()

  const user = await db.prepare(
    "SELECT id, email, password_hash FROM users WHERE id = ?"
  ).bind(userId).first<{ id: string; email: string; password_hash: string }>()

  if (!user) {
    return c.json({ error: "user_not_found" }, 404)
  }

  // Change password
  if (new_password) {
    if (!current_password) {
      return c.json({ error: "current_password_required" }, 400)
    }
    const valid = await verifyPassword(current_password, user.password_hash)
    if (!valid) {
      return c.json({ error: "invalid_current_password" }, 403)
    }
    const newHash = await hashPassword(new_password)
    await db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").bind(newHash, userId).run()
  }

  // Change email
  if (email && email !== user.email) {
    const existing = await db.prepare("SELECT id FROM users WHERE email = ?").bind(email).first()
    if (existing) {
      return c.json({ error: "email_already_registered" }, 409)
    }
    await db.prepare("UPDATE users SET email = ? WHERE id = ?").bind(email, userId).run()
  }

  const updated = await db.prepare(
    "SELECT id, email, created_at FROM users WHERE id = ?"
  ).bind(userId).first<{ id: string; email: string; created_at: number }>()

  return c.json(updated!)
})

// DELETE /user/me
userRouter.delete("/me", requireAuth, async (c) => {
  const userId = c.get("userId")
  const db = getDB()

  await db.prepare("DELETE FROM refresh_tokens WHERE user_id = ?").bind(userId).run()
  await db.prepare("DELETE FROM subscriptions WHERE user_id = ?").bind(userId).run()
  await db.prepare("DELETE FROM users WHERE id = ?").bind(userId).run()

  return c.body(null, 204)
})
