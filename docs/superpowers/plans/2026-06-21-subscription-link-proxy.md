# 订阅链接代理及流量响应头实现计划

> **给智能体的执行说明：** 必须使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 技能来逐项执行本计划。步骤使用复选框 (`- [ ]`) 语法进行跟踪。

**目标：** 实现订阅链接以“当前域名 + 唯一值”形式生成，并且当请求该链接时，Worker 会将请求代理到真实的订阅配置文件后端，并在 HTTP 响应头中携带符合标准的流量及过期时间信息。

**架构：**
1. 在 `index.ts` 中注册公共接口 `GET /sub/:token`，它会从 D1 数据库查询该 Token 对应的订阅状态，验证有效期及流量后，通过 `fetch` 代理获取真实配置，最后向客户端返回配置数据并注入 `subscription-userinfo` 响应头。
2. 在 `subscriptions.ts` 中，当为用户初始化默认订阅时，获取当前的 Request Host，生成唯一的订阅链接 `${host}/sub/${uniqueToken}` 写入数据库。
3. 修改路由响应的返回，直接返回数据库中的 `subscription_url` 字段。

**技术栈：** TypeScript, Hono, Cloudflare Workers, D1 (SQLite)

---

### 任务 1：在 index.ts 中实现订阅代理路由

**相关文件：**
- 修改：`src/index.ts`

- [ ] **步骤 1：添加 GET /sub/:token 接口**

在 `src/index.ts` 中注册 `app.get("/sub/:token", ...)` 接口，查询对应的订阅信息，如果正常则代理请求真实配置并写入响应头。

修改 `src/index.ts`（在 `// Routes` 之前插入以下逻辑）：

```typescript
// 订阅代理公共路由（不需要 requireAuth）
app.get("/sub/:token", async (c) => {
  const token = c.req.param("token")
  const db = initDB(c.env.DB) || getDB() // 确保数据库已初始化

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
```

- [ ] **步骤 2：运行类型检查**

运行：`npm run lint`
预期：类型检查通过，无错误。

- [ ] **步骤 3：提交代码**

```bash
git add src/index.ts
git commit -m "feat: add subscription proxy route /sub/:token in index.ts"
```

---

### 任务 2：在 subscriptions.ts 中实现动态 URL 初始化与返回

**相关文件：**
- 修改：`src/routes/subscriptions.ts`

- [ ] **步骤 1：修改默认订阅初始化与查询返回逻辑**

修改 `src/routes/subscriptions.ts`：
1. 在 `subscriptionsRouter.get("/")` 中，当 `results.length === 0` 时，动态获取请求的 Host `const currentDomain = new URL(c.req.url).origin`，生成唯一 Token `const uniqueToken = uid()`，将包含本地域名的订阅链接保存到数据库。
2. 返回列表与查询单个详情时，使用数据库查出的 `r.subscription_url` / `sub.subscription_url`。

具体修改内容（替换相应行）：

```typescript
// 替换 src/routes/subscriptions.ts 中的 results 映射以及 results.length === 0 初始化逻辑：

  let results = rows.results.map((r) => ({
    id: r.id,
    name: r.name,
    url: r.subscription_url, // 返回数据库中真实的订阅 URL
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
    const expireTime = now + 365 * 24 * 3600 // 1 年
    const defaultName = "Chilix Tunnel Premium"
    const totalTraffic = 1024 * 1024 * 1024 * 1024 // 1 TB

    await db.prepare(
      "INSERT INTO subscriptions (id, user_id, name, subscription_url, total_traffic, used_traffic, expire_time, created_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)"
    ).bind(newId, userId, defaultName, subscriptionUrl, totalTraffic, expireTime, now).run()

    // 重新查询
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
```

同时，修改单条订阅详情接口（`subscriptionsRouter.get("/:id")`）中的详情返回，对于从数据库查询出的数据：
```typescript
  return c.json({
    id: sub.id,
    name: sub.name,
    url: sub.subscription_url, // 返回数据库中真实的订阅 URL
    traffic_used: sub.used_traffic,
    traffic_total: sub.total_traffic,
    expire_time: sub.expire_time,
    created_at: sub.created_at,
  })
```

- [ ] **步骤 2：运行类型检查**

运行：`npm run lint`
预期：没有类型错误。

- [ ] **步骤 3：提交代码**

```bash
git add src/routes/subscriptions.ts
git commit -m "feat: implement dynamic subscription url generation and return real url from db"
```

---

### 任务 3：部署与手动验证

**相关文件：**
- 无

- [ ] **步骤 1：部署到 Cloudflare**

运行：`npx wrangler deploy`
预期：成功部署，无错误。

- [ ] **步骤 2：手动运行验证脚本**

在本地或远程发送测试请求：
1. 注册/登录测试用户，获取列表。
2. 期望获取的列表中存在一条链接形如 `https://<your_domain>/sub/<unique_token>` 的订阅。
3. 对该链接发送 `GET` 请求。
4. 期望返回真实的订阅配置文本，且 Response Headers 中包含：
   `subscription-userinfo: upload=0; download=0; total=1099511627776; expire=<timestamp>`
5. 对该订阅的 ID 上报一部分消耗流量（如 10MB）。
6. 再次请求订阅链接，期望 `subscription-userinfo` 响应头中的 `download` 值变为对应的字节数（如 `10485760`）。
