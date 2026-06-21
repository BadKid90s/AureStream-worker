import { Hono } from "hono"
import { z } from "zod"
import { requireAuth } from "../middleware/auth.js"
import { getDB, uid } from "../db/index.js"
import type { Env, AppVariables } from "../config/index.js"

export const subscriptionsRouter = new Hono<{ Bindings: Env; Variables: AppVariables }>()

// GET /subscriptions
subscriptionsRouter.get("/", requireAuth, async (c) => {
  const userId = c.get("userId")
  const db = getDB()

  const rows = await db.prepare(
    "SELECT id, name, subscription_url, total_traffic, used_traffic, expire_time, created_at FROM subscriptions WHERE user_id = ? ORDER BY created_at DESC"
  ).bind(userId).all<{
    id: string; name: string; subscription_url: string
    total_traffic: number; used_traffic: number; expire_time: number; created_at: number
  }>()

  let results = rows.results.map((r) => ({
    id: r.id,
    name: r.name,
    url: r.subscription_url,
    traffic_used: r.used_traffic,
    traffic_total: r.total_traffic,
    expire_time: r.expire_time,
    created_at: r.created_at,
  }))

  if (results.length === 0) {
    const newId = uid()
    const uniqueToken = uid()
    const urlObj = new URL(c.req.url)
    const currentDomain = `${urlObj.protocol}//${urlObj.host}`
    const subscriptionUrl = `${currentDomain}/sub/${uniqueToken}`
    const now = Math.floor(Date.now() / 1000)
    const expireTime = now + 365 * 24 * 3600 // 1 year
    const defaultName = "Chilix Tunnel Premium"
    const totalTraffic = 1024 * 1024 * 1024 * 1024 // 1 TB

    await db.prepare(
      "INSERT INTO subscriptions (id, user_id, name, subscription_url, total_traffic, used_traffic, expire_time, created_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)"
    ).bind(newId, userId, defaultName, subscriptionUrl, totalTraffic, expireTime, now).run()

    // Re-query to get the new database record
    const rowsNew = await db.prepare(
      "SELECT id, name, subscription_url, total_traffic, used_traffic, expire_time, created_at FROM subscriptions WHERE user_id = ? ORDER BY created_at DESC"
    ).bind(userId).all<{
      id: string; name: string; subscription_url: string
      total_traffic: number; used_traffic: number; expire_time: number; created_at: number
    }>()

    results = rowsNew.results.map((r) => ({
      id: r.id,
      name: r.name,
      url: r.subscription_url,
      traffic_used: r.used_traffic,
      traffic_total: r.total_traffic,
      expire_time: r.expire_time,
      created_at: r.created_at,
    }))
  }

  return c.json({
    subscriptions: results,
  })
})

// GET /subscriptions/:id
subscriptionsRouter.get("/:id", requireAuth, async (c) => {
  const userId = c.get("userId")
  const id = c.req.param("id")
  const db = getDB()

  if (id === "default-sub") {
    return c.json({
      id: "default-sub",
      name: "Chilix Tunnel Premium",
      url: "https://tunnel.chilix.ccwu.cc/sub?token=9acdf66961219ba1406bfd16a1bece07",
      traffic_used: 0,
      traffic_total: 1024 * 1024 * 1024 * 1024, // 1 TB
      expire_time: Math.floor(Date.now() / 1000) + 365 * 24 * 3600, // 1 year
      created_at: Math.floor(Date.now() / 1000) - 5 * 24 * 3600,
    })
  }

  const sub = await db.prepare(
    "SELECT id, name, subscription_url, total_traffic, used_traffic, expire_time, created_at FROM subscriptions WHERE id = ? AND user_id = ?"
  ).bind(id, userId).first<{
    id: string; name: string; subscription_url: string
    total_traffic: number; used_traffic: number; expire_time: number; created_at: number
  }>()

  if (!sub) {
    return c.json({ error: "not_found" }, 404)
  }

  return c.json({
    id: sub.id,
    name: sub.name,
    url: sub.subscription_url,
    traffic_used: sub.used_traffic,
    traffic_total: sub.total_traffic,
    expire_time: sub.expire_time,
    created_at: sub.created_at,
  })
})

// POST /subscriptions
subscriptionsRouter.post("/", requireAuth, async (c) => {
  const userId = c.get("userId")
  const body = await c.req.json()
  const parsed = z.object({
    name: z.string().min(1),
    url: z.string().url(),
    traffic_total: z.number().optional(),
    expire_time: z.number().optional(),
  }).safeParse(body)

  if (!parsed.success) {
    return c.json({ error: "invalid_request", details: parsed.error.issues }, 400)
  }

  const db = getDB()
  const id = uid()
  const now = Math.floor(Date.now() / 1000)
  const expireTime = parsed.data.expire_time ?? now + 365 * 24 * 3600
  const totalTraffic = parsed.data.traffic_total ?? 0

  await db.prepare(
    "INSERT INTO subscriptions (id, user_id, name, subscription_url, total_traffic, used_traffic, expire_time, created_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)"
  ).bind(id, userId, parsed.data.name, parsed.data.url, totalTraffic, expireTime, now).run()

  return c.json({
    id,
    name: parsed.data.name,
    url: parsed.data.url,
    traffic_used: 0,
    traffic_total: totalTraffic,
    expire_time: expireTime,
    created_at: now,
  }, 201)
})

// PUT /subscriptions/:id
subscriptionsRouter.put("/:id", requireAuth, async (c) => {
  const userId = c.get("userId")
  const id = c.req.param("id")
  const body = await c.req.json()
  const parsed = z.object({
    name: z.string().min(1).optional(),
  }).safeParse(body)

  if (!parsed.success) {
    return c.json({ error: "invalid_request", details: parsed.error.issues }, 400)
  }

  const db = getDB()
  const sub = await db.prepare("SELECT id FROM subscriptions WHERE id = ? AND user_id = ?")
    .bind(id, userId).first()

  if (!sub) {
    return c.json({ error: "not_found" }, 404)
  }

  if (parsed.data.name) {
    await db.prepare("UPDATE subscriptions SET name = ? WHERE id = ?").bind(parsed.data.name, id).run()
  }

  const updated = await db.prepare(
    "SELECT id, name, subscription_url, total_traffic, used_traffic, expire_time, created_at FROM subscriptions WHERE id = ?"
  ).bind(id).first<{
    id: string; name: string; subscription_url: string
    total_traffic: number; used_traffic: number; expire_time: number; created_at: number
  }>()

  return c.json({
    id: updated!.id,
    name: updated!.name,
    url: updated!.subscription_url,
    traffic_used: updated!.used_traffic,
    traffic_total: updated!.total_traffic,
    expire_time: updated!.expire_time,
    created_at: updated!.created_at,
  })
})

// DELETE /subscriptions/:id
subscriptionsRouter.delete("/:id", requireAuth, async (c) => {
  const userId = c.get("userId")
  const id = c.req.param("id")
  const db = getDB()

  const sub = await db.prepare("SELECT id FROM subscriptions WHERE id = ? AND user_id = ?")
    .bind(id, userId).first()
  if (!sub) return c.json({ error: "not_found" }, 404)

  await db.prepare("DELETE FROM subscriptions WHERE id = ?").bind(id).run()
  return c.body(null, 204)
})

// POST /subscriptions/:id/usage  — report traffic usage (cumulative)
subscriptionsRouter.post("/:id/usage", requireAuth, async (c) => {
  const userId = c.get("userId")
  const id = c.req.param("id")
  const body = await c.req.json()
  const parsed = z.object({
    upload: z.number().int().min(0),
    download: z.number().int().min(0),
  }).safeParse(body)

  if (!parsed.success) {
    return c.json({ error: "invalid_request", details: parsed.error.issues }, 400)
  }

  const { upload, download } = parsed.data
  const addedTraffic = upload + download
  const db = getDB()

  const sub = await db.prepare("SELECT id FROM subscriptions WHERE id = ? AND user_id = ?")
    .bind(id, userId).first()
  if (!sub) return c.json({ error: "not_found" }, 404)

  await db.prepare("UPDATE subscriptions SET used_traffic = used_traffic + ? WHERE id = ?")
    .bind(addedTraffic, id).run()

  const updated = await db.prepare(
    "SELECT used_traffic, total_traffic FROM subscriptions WHERE id = ?"
  ).bind(id).first<{ used_traffic: number; total_traffic: number }>()

  return c.json({
    traffic_used: updated!.used_traffic,
    traffic_total: updated!.total_traffic,
  })
})
