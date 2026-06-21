# Subscription Traffic Cumulative Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Modify the subscription traffic update API to accept separate upload and download fields, and accumulate them cumulatively into the database using JWT authentication.

**Architecture:** Update Hono route body parsing with Zod schema for upload/download and replace the SQL UPDATE query to increment used_traffic instead of overwriting it.

**Tech Stack:** TypeScript, Hono, Zod, Cloudflare D1 (SQLite)

---

### Task 1: Update subscriptions.ts Endpoint

**Files:**
- Modify: `src/routes/subscriptions.ts`

- [ ] **Step 1: Replace schema and database query**

Modify the endpoint `POST /:id/usage` in `src/routes/subscriptions.ts` to:
- Use Zod schema to parse `upload` (integer, >= 0) and `download` (integer, >= 0).
- Calculate cumulative traffic added = `upload + download`.
- Perform SQL update query: `UPDATE subscriptions SET used_traffic = used_traffic + ? WHERE id = ? AND user_id = ?`.

```typescript
// Replace lines 181-211 in src/routes/subscriptions.ts with the following:

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
```

- [ ] **Step 2: Run local type check**

Run: `npm run lint` (runs `tsc --noEmit`)
Expected: Exit code 0 (no TypeScript errors)

- [ ] **Step 3: Commit**

```bash
git add src/routes/subscriptions.ts
git commit -m "feat: modify subscription usage update to cumulative upload/download"
```

---

### Task 2: Build and Deploy

**Files:**
- None

- [ ] **Step 1: Deploy to Cloudflare**

Run: `npx wrangler deploy`
Expected: Successfully deployed aurestream-worker and returned deployed URL.

- [ ] **Step 2: Commit**

```bash
git commit --allow-empty -m "deploy: deploy traffic update cumulative endpoint"
```

---

### Task 3: Manual Verification

**Files:**
- None

- [ ] **Step 1: Verify using local dev or remote endpoint**

Use the following manual curl calls or requests to check behavior:
1. Log in or use a valid JWT token to fetch the subscription details first:
   `GET /api/subscriptions/:id` -> Note the current `traffic_used`.
2. Call the updated usage API:
   `POST /api/subscriptions/:id/usage` with body `{"upload": 1000, "download": 2000}`.
3. Check the response body:
   Expected: `traffic_used` should increase by exactly 3000 bytes compared to the previous step.
