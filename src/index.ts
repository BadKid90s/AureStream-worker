import { Hono } from "hono"
import { cors } from "hono/cors"
import type { Env } from "./config/index.js"
import { initDB, getDB } from "./db/index.js"
import { authRouter } from "./routes/auth.js"
import { userRouter } from "./routes/user.js"
import { subscriptionsRouter } from "./routes/subscriptions.js"

const app = new Hono<{ Bindings: Env }>()

app.use("*", async (c, next) => {
  initDB(c.env.DB)
  await next()
})

app.use("*", cors())

// Health check
app.get("/api/health", (c) => c.json({ status: "ok" }))

// 订阅代理公共路由（不需要 requireAuth）
app.get("/sub/:token", async (c) => {
  const token = c.req.param("token")
  initDB(c.env.DB) // 确保在当前请求上下文初始化数据库
  const db = getDB()

  // 使用 LIKE 模糊匹配查询该 token 的订阅
  const sub = await db.prepare(
    "SELECT id, total_traffic, used_traffic, expire_time FROM subscriptions WHERE subscription_url LIKE ?"
  ).bind(`%/sub/${token}`).first<{ id: string; total_traffic: number; used_traffic: number; expire_time: number }>()

  if (!sub) {
    return c.text("Subscription not found", 404)
  }

  const now = Math.floor(Date.now() / 1000)
  if (sub.expire_time < now) {
    return c.text("Subscription expired", 403)
  }

  if (sub.used_traffic >= sub.total_traffic) {
    return c.text("Traffic limit exceeded", 403)
  }

  // 映射请求真实的订阅配置后端
  const realUrl = "https://tunnel.chilix.ccwu.cc/sub?token=9acdf66961219ba1406bfd16a1bece07"
  const response = await fetch(realUrl)
  
  if (!response.ok) {
    return c.text("Failed to fetch configuration", 502)
  }

  const configText = await response.text()
  
  // 设置响应头
  c.header("Content-Type", response.headers.get("Content-Type") || "text/plain; charset=utf-8")
  // 注入标准流量响应头：subscription-userinfo
  c.header(
    "subscription-userinfo",
    `upload=0; download=${sub.used_traffic}; total=${sub.total_traffic}; expire=${sub.expire_time}`
  )

  return c.text(configText)
})

// Routes
app.route("/api/auth", authRouter)
app.route("/api/user", userRouter)
app.route("/api/subscriptions", subscriptionsRouter)

export default app
