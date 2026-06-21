# Spec: Subscription Link Proxying with Traffic Headers

This specification details the implementation of unique subscription URL generation using the current domain, proxying subscription download requests to the real backend, and returning traffic and expiration data via standard HTTP headers.

## Proposed Changes

### 1. Subscription URL Generation
- **Endpoint**: `GET /api/subscriptions` (and `GET /api/subscriptions/:id`)
- **Behavior**:
  - When automatically initializing the default subscription for a new user, the URL will be generated using the request's current host:
    `const currentDomain = new URL(c.req.url).origin`
    `const uniqueToken = uid()`
    `const subscriptionUrl = `${currentDomain}/sub/${uniqueToken}``
  - This URL is stored in the database's `subscription_url` column.
  - The API returns `url: r.subscription_url` from the database.

### 2. Subscription Proxy Endpoint
- **Endpoint**: `GET /sub/:token` (unauthenticated public endpoint)
- **Behavior**:
  1. Retrieve the `:token` parameter.
  2. Query database for subscription row:
     `SELECT total_traffic, used_traffic, expire_time FROM subscriptions WHERE subscription_url LIKE ?`
     with binding `%/sub/${token}`.
  3. If not found, return `404 Not Found`.
  4. If found:
     - Check if expired: `expire_time < Math.floor(Date.now() / 1000)`. If expired, return `403 Forbidden` with "Subscription expired".
     - Check if traffic exceeded: `used_traffic >= total_traffic`. If exceeded, return `403 Forbidden` with "Traffic limit exceeded".
     - Proxy fetch the configuration file from:
       `https://tunnel.chilix.ccwu.cc/sub?token=9acdf66961219ba1406bfd16a1bece07`
     - Respond to the client with the fetched configuration data.
     - Inject standard traffic header:
       `subscription-userinfo: upload=0; download=${used_traffic}; total=${total_traffic}; expire=${expire_time}`
     - Return the response.

### Affected Files
- [index.ts](file:///Users/wry/IdeaProjects/AureStream-worker/src/index.ts)
- [subscriptions.ts](file:///Users/wry/IdeaProjects/AureStream-worker/src/routes/subscriptions.ts)
