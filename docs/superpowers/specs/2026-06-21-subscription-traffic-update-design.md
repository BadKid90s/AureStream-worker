# Spec: Subscription Traffic Usage Cumulative Update

This specification details the modification of the existing subscription traffic usage update endpoint to support separate upload/download traffic fields and accumulate them cumulatively into the database under JWT authentication.

## Proposed Changes

### Endpoint Modification
- **Path**: `POST /api/subscriptions/:id/usage`
- **Authentication**: JWT-based User Authentication (`requireAuth` middleware)
- **Request Body (JSON)**:
  ```json
  {
    "upload": 1048576,    // Upload traffic in bytes (integer, >= 0)
    "download": 10485760  // Download traffic in bytes (integer, >= 0)
  }
  ```
- **Response Body (JSON)**:
  ```json
  {
    "traffic_used": 11534336, // Total cumulative used traffic in bytes
    "traffic_total": 107374182400 // Total allocated traffic in bytes
  }
  ```

### Database Updates
We will change the SQL execution query from overwriting `used_traffic` to accumulating it:
```sql
UPDATE subscriptions 
SET used_traffic = used_traffic + ? 
WHERE id = ? AND user_id = ?
```
Here, the value passed to the binder is `upload + download`.

### Affected Files
- [subscriptions.ts](file:///Users/wry/IdeaProjects/AureStream-worker/src/routes/subscriptions.ts)
