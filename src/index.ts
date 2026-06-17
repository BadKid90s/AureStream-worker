import { Hono } from "hono"
import { cors } from "hono/cors"
import type { Env } from "./config/index.js"
import { initDB } from "./db/index.js"
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
app.get("/health", (c) => c.json({ status: "ok" }))

// Routes
app.route("/auth", authRouter)
app.route("/user", userRouter)
app.route("/subscriptions", subscriptionsRouter)

export default app
