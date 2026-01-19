# API Documentation Template

## Endpoint Overview

**Endpoint**: `[METHOD] /api/v1/resource`

**Description**: [Brief description of what this endpoint does - 1-2 sentences]

**Authentication**: [Required/Optional] - [Type: Bearer token, API key, etc.]

---

## Request

### Headers

| Header | Required | Description |
|--------|----------|-------------|
| `Authorization` | Yes | Bearer token for authentication |
| `Content-Type` | Yes | `application/json` |
| `X-Request-ID` | No | Optional request tracking ID |

### Path Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string | Yes | Unique identifier of the resource |

### Query Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | integer | 1 | Page number for pagination |
| `limit` | integer | 20 | Number of items per page (max: 100) |
| `sort` | string | `created_at` | Field to sort by |
| `order` | string | `desc` | Sort order: `asc` or `desc` |

### Request Body

```json
{
  "name": "string (required) - Display name, 1-100 characters",
  "email": "string (required) - Valid email address",
  "role": "string (optional) - One of: admin, user, guest. Default: user",
  "metadata": {
    "key": "value (optional) - Custom key-value pairs"
  }
}
```

### Request Example

```bash
curl -X POST https://api.example.com/api/v1/users \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Jane Smith",
    "email": "jane@example.com",
    "role": "admin"
  }'
```

---

## Response

### Success Response

**Status Code**: `201 Created`

```json
{
  "data": {
    "id": "usr_abc123",
    "name": "Jane Smith",
    "email": "jane@example.com",
    "role": "admin",
    "created_at": "2024-01-15T10:30:00Z",
    "updated_at": "2024-01-15T10:30:00Z"
  },
  "meta": {
    "request_id": "req_xyz789"
  }
}
```

### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `data.id` | string | Unique identifier (prefixed with `usr_`) |
| `data.name` | string | User's display name |
| `data.email` | string | User's email address |
| `data.role` | string | User's role in the system |
| `data.created_at` | string | ISO 8601 timestamp of creation |
| `data.updated_at` | string | ISO 8601 timestamp of last update |
| `meta.request_id` | string | Request tracking identifier |

---

## Error Responses

### 400 Bad Request

Returned when the request body is invalid.

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": [
      {
        "field": "email",
        "message": "Invalid email format"
      }
    ]
  }
}
```

### 401 Unauthorized

Returned when authentication fails.

```json
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Invalid or expired token"
  }
}
```

### 403 Forbidden

Returned when the user lacks permission.

```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "Insufficient permissions to perform this action"
  }
}
```

### 404 Not Found

Returned when the resource doesn't exist.

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Resource not found"
  }
}
```

### 429 Too Many Requests

Returned when rate limit is exceeded.

```json
{
  "error": {
    "code": "RATE_LIMITED",
    "message": "Rate limit exceeded. Try again in 60 seconds",
    "retry_after": 60
  }
}
```

### 500 Internal Server Error

Returned when an unexpected error occurs.

```json
{
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "An unexpected error occurred",
    "request_id": "req_xyz789"
  }
}
```

---

## Error Codes Reference

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `VALIDATION_ERROR` | 400 | Request body validation failed |
| `UNAUTHORIZED` | 401 | Authentication required or failed |
| `FORBIDDEN` | 403 | Authenticated but not authorized |
| `NOT_FOUND` | 404 | Resource does not exist |
| `CONFLICT` | 409 | Resource already exists |
| `RATE_LIMITED` | 429 | Too many requests |
| `INTERNAL_ERROR` | 500 | Server-side error |

---

## Rate Limits

| Plan | Requests/Minute | Requests/Day |
|------|-----------------|--------------|
| Free | 60 | 1,000 |
| Pro | 300 | 10,000 |
| Enterprise | 1,000 | Unlimited |

Rate limit headers are included in every response:
- `X-RateLimit-Limit`: Maximum requests allowed
- `X-RateLimit-Remaining`: Requests remaining in window
- `X-RateLimit-Reset`: Unix timestamp when limit resets

---

## Code Examples

### Python

```python
import requests

url = "https://api.example.com/api/v1/users"
headers = {
    "Authorization": "Bearer YOUR_TOKEN",
    "Content-Type": "application/json"
}
data = {
    "name": "Jane Smith",
    "email": "jane@example.com",
    "role": "admin"
}

response = requests.post(url, json=data, headers=headers)

if response.status_code == 201:
    user = response.json()["data"]
    print(f"Created user: {user['id']}")
else:
    error = response.json()["error"]
    print(f"Error: {error['message']}")
```

### JavaScript (Node.js)

```javascript
const response = await fetch('https://api.example.com/api/v1/users', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer YOUR_TOKEN',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    name: 'Jane Smith',
    email: 'jane@example.com',
    role: 'admin'
  })
});

if (response.ok) {
  const { data } = await response.json();
  console.log(`Created user: ${data.id}`);
} else {
  const { error } = await response.json();
  console.error(`Error: ${error.message}`);
}
```

---

## Related Endpoints

- [GET /api/v1/users](#) - List all users
- [GET /api/v1/users/:id](#) - Get a specific user
- [PATCH /api/v1/users/:id](#) - Update a user
- [DELETE /api/v1/users/:id](#) - Delete a user

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.1.0 | 2024-02-01 | Added `metadata` field to request body |
| 1.0.0 | 2024-01-01 | Initial release |
