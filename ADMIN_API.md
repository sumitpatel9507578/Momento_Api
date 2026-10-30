# Momento Admin API

All protected endpoints require `Authorization: Bearer <JWT>`. All successful responses use `success: true`. Errors use `success: false` and include `message`.

## Authentication

| Method | Endpoint | Auth | Body/query | Response |
|---|---|---|---|---|
| POST | `/api/admin/login` | Public | `{ "email": "admin@example.com", "password": "..." }` | Admin JWT and user |
| POST | `/api/admin/register` | Public with registration code | `{ "username": "...", "email": "...", "password": "...", "fullName": "...", "adminCode": "...", "registrationCode": "..." }` | Admin JWT and user |
| GET | `/api/admin/profile` | Admin | None | Admin profile |
| PUT/PATCH | `/api/admin/profile` | Admin | Supported fields such as `fullName`, `username`, `email`, `bio`, `profileImage` | Updated profile |
| PUT | `/api/admin/password` | Admin | `{ "currentPassword": "...", "newPassword": "..." }` | Success |
| POST | `/api/admin/change-password` | Admin | Same as above | Success |

`ADMIN_REGISTRATION_CODE` must be configured on the server. Never send or return the configured code.

## User moderation

| Method | Endpoint | Body/query |
|---|---|---|
| GET | `/api/admin/users` | `page`, `limit`, `search`, `status=active|blocked`, `role=user|admin` |
| GET | `/api/admin/users/:id` | None |
| POST/PUT | `/api/admin/users/:id/block` | None |
| POST/PUT | `/api/admin/users/:id/unblock` | None |
| POST/PUT | `/api/admin/users/:id/verify` | None |
| DELETE | `/api/admin/users/:id/verify` or POST `/api/admin/users/:id/unverify` | None |
| PUT | `/api/admin/users/:id/role` | `{ "role": "user\|admin" }` |
| POST | `/api/admin/users/:id/promote` | None |
| POST | `/api/admin/users/:id/demote` | None |
| DELETE | `/api/admin/users/:id` | Permanently deletes the account |

## Content moderation

| Method | Endpoint | Query |
|---|---|---|
| GET | `/api/admin/posts` | `page`, `limit`, `search`, `caption`, `username`, `fullName` |
| GET | `/api/admin/posts/:id` | None |
| DELETE | `/api/admin/posts/:id` | Deletes database relations, known media references, and Cloudinary media when configured |
| GET | `/api/admin/reels` | `page`, `limit`, `search`, `caption`, `username`, `song`, `song_name` |
| GET | `/api/admin/reels/:id` | None |
| DELETE | `/api/admin/reels/:id` | Deletes database relations, known media references, and Cloudinary video media |

## Analytics

| Method | Endpoint | Query |
|---|---|---|
| GET | `/api/admin/dashboard/overview` | None |
| GET | `/api/admin/dashboard/growth` | `from=YYYY-MM-DD`, `to=YYYY-MM-DD` |
| GET | `/api/admin/dashboard/engagement` | None |
| GET | `/api/admin/dashboard/trending` | `limit` |
| GET | `/api/admin/dashboard/export/csv` | None |
| GET | `/api/admin/dashboard/export/pdf` | None |

Reach analytics report `reachAvailable: false` until `content_views` contains tracked data. Product post and reel detail endpoints now record view events after the migration is applied.

## Settings and health

| Method | Endpoint | Body/query |
|---|---|---|
| GET | `/api/admin/settings` | None |
| PUT/PATCH | `/api/admin/settings` | Boolean values for supported settings |
| GET | `/api/admin/health` | Includes API/database status, uptime and safe environment information |

Supported settings: `maintenanceMode`, `allowUserRegistration`, `reportAutoReview`, `requirePostApproval`.

## Migration and deployment

1. Add `ADMIN_REGISTRATION_CODE=<strong-secret>` to `.env` or the hosting environment.
2. Apply `migrations/add-admin-api-support.sql`.
3. Ensure existing admin accounts have `role = 'admin'`.
4. Restart the API.

Example:

```json
{
  "success": true,
  "data": {
    "totalUsers": 37,
    "totalPosts": 2
  }
}
```

Example errors:

```json
{
  "success": false,
  "message": "Administrator access required"
}
```
