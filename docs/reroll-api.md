# Connections API: Reroll Endpoint

## POST /games/{gameId}/reroll

Deletes the specified game and triggers regeneration. Requires a password.

### Request

**URL:** `https://connections-api.dbowland.com/v1/games/{gameId}/reroll`

**Method:** `POST`

**Path Parameters:**

| Parameter | Type   | Description                                                                                  |
| --------- | ------ | -------------------------------------------------------------------------------------------- |
| `gameId`  | string | ISO date string (e.g. `2026-03-28`). Must be between `2025-01-01` and today (UTC) inclusive. |

**Headers:**

| Header         | Value              |
| -------------- | ------------------ |
| `Content-Type` | `application/json` |

**Body:**

```json
{
  "password": "your-password-here"
}
```

### Responses

| Status                      | Meaning                                                                         | Body                                         |
| --------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------- |
| `202 Accepted`              | Game deleted and regeneration started                                           | `{ "message": "Game is being regenerated" }` |
| `400 Bad Request`           | Invalid `gameId` format, date out of range, missing `password`, or invalid JSON | `{ "error": "..." }`                         |
| `403 Forbidden`             | Wrong password                                                                  | _(no body — do not parse as JSON)_           |
| `500 Internal Server Error` | Server-side error                                                               | `{ "message": "Internal server error" }`     |

### Notes

- `400` errors use an `error` key in the body (e.g. `{ "error": "Invalid gameId" }`). `500` errors use a `message` key.
- After a `202` response, the game for that date is deleted. Subsequent `GET /games/{gameId}` calls will return `202 Accepted` with `{ "message": "Game is being generated" }` until the new game is ready — this can take up to 15 minutes.
- Dates in the future (tomorrow or later per UTC) are rejected with `400`.
- The password is never returned by any API endpoint.

### Example

```http
POST https://connections-api.dbowland.com/v1/games/2026-03-28/reroll HTTP/1.1
Content-Type: application/json

{ "password": "your-password-here" }
```
