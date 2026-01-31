# API Documentation Best Practices

Comprehensive guide to writing clear, complete, and developer-friendly API documentation.

---

## Core Principles

### 1. Developer Experience First

API documentation exists to help developers succeed. Every decision should prioritize:
- How quickly can a developer get started?
- How easily can they find what they need?
- How clearly can they understand the API behavior?

### 2. Show, Don't Just Tell

- Lead with examples
- Provide working, copy-paste code
- Show both requests AND responses
- Include error examples

### 3. Be Complete

- Document every endpoint
- List all parameters
- Show all response fields
- Cover all error cases

---

## Essential Components

### 1. Overview/Getting Started

Every API documentation should begin with:

**Authentication**
- How to get credentials
- How to authenticate requests
- Token refresh mechanisms
- Example authenticated request

**Base URL**
```
Production: https://api.example.com/v1
Sandbox: https://sandbox.api.example.com/v1
```

**Quick Start**
- Minimal steps to make first successful request
- Working code example
- Expected response

### 2. Endpoint Reference

Each endpoint needs:

**HTTP Method and Path**
```
POST /api/v1/users
GET /api/v1/users/{id}
```

**Description**
- What the endpoint does
- When to use it
- Prerequisites or requirements

**Request Details**
- Headers (required and optional)
- Path parameters
- Query parameters
- Request body schema

**Response Details**
- Status codes
- Response body schema
- Field descriptions

**Examples**
- Complete request example
- Complete response example
- Multiple scenarios if needed

---

## Parameter Documentation

### Required vs Optional

Clearly distinguish required from optional:

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `user_id` | string | **Yes** | Unique user identifier |
| `limit` | integer | No | Max results (default: 20) |

### Data Types

Be explicit about types:
- `string` - text values
- `integer` - whole numbers
- `number` - decimal values
- `boolean` - true/false
- `array` - list of items
- `object` - nested structure
- `enum` - specific allowed values

### Constraints

Document all constraints:
- Minimum/maximum values
- String length limits
- Allowed characters (regex patterns)
- Format requirements (ISO 8601, UUID, etc.)

### Default Values

Always specify:
- What happens if parameter is omitted
- Default value used
- Default behavior

---

## Request Body Documentation

### Schema Format

Use clear, annotated JSON:

```json
{
  "name": "string (required) - User's display name, 1-100 characters",
  "email": "string (required) - Valid email address",
  "role": "enum (optional) - One of: 'admin', 'user', 'guest'. Default: 'user'",
  "settings": {
    "notifications": "boolean (optional) - Enable email notifications. Default: true",
    "theme": "enum (optional) - One of: 'light', 'dark'. Default: 'light'"
  }
}
```

### Examples

Provide realistic examples:

```json
{
  "name": "Jane Smith",
  "email": "jane@example.com",
  "role": "admin",
  "settings": {
    "notifications": true,
    "theme": "dark"
  }
}
```

---

## Response Documentation

### Success Responses

**Status Code**
- 200 OK - Successful GET, PUT, PATCH
- 201 Created - Successful POST creating resource
- 204 No Content - Successful DELETE

**Response Body**
```json
{
  "data": {
    "id": "usr_abc123",
    "name": "Jane Smith",
    "email": "jane@example.com",
    "created_at": "2024-01-15T10:30:00Z"
  },
  "meta": {
    "request_id": "req_xyz789"
  }
}
```

**Field Descriptions Table**
| Field | Type | Description |
|-------|------|-------------|
| `data.id` | string | Unique identifier (usr_ prefix) |
| `data.created_at` | string | ISO 8601 timestamp |

### Pagination

Document pagination clearly:

```json
{
  "data": [...],
  "pagination": {
    "page": 1,
    "per_page": 20,
    "total_pages": 5,
    "total_count": 100
  },
  "links": {
    "first": "/api/v1/users?page=1",
    "prev": null,
    "next": "/api/v1/users?page=2",
    "last": "/api/v1/users?page=5"
  }
}
```

---

## Error Documentation

### Error Response Format

Use consistent error structure:

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
    ],
    "request_id": "req_xyz789"
  }
}
```

### Common Error Codes

| HTTP Status | Error Code | Description |
|-------------|------------|-------------|
| 400 | VALIDATION_ERROR | Invalid request body |
| 400 | INVALID_PARAMETER | Invalid query/path parameter |
| 401 | UNAUTHORIZED | Missing or invalid authentication |
| 403 | FORBIDDEN | Lacks permission |
| 404 | NOT_FOUND | Resource doesn't exist |
| 409 | CONFLICT | Resource already exists |
| 422 | UNPROCESSABLE | Valid syntax but cannot process |
| 429 | RATE_LIMITED | Too many requests |
| 500 | INTERNAL_ERROR | Server error |

### Error Examples

Show examples for each error type:

**400 Bad Request**
```bash
curl -X POST https://api.example.com/v1/users \
  -H "Authorization: Bearer token" \
  -d '{"email": "invalid-email"}'
```

Response:
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid email format",
    "details": [{"field": "email", "message": "Must be a valid email address"}]
  }
}
```

---

## Code Examples

### Multiple Languages

Provide examples in popular languages:

**cURL**
```bash
curl -X POST https://api.example.com/v1/users \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Jane", "email": "jane@example.com"}'
```

**Python**
```python
import requests

response = requests.post(
    "https://api.example.com/v1/users",
    headers={"Authorization": "Bearer YOUR_TOKEN"},
    json={"name": "Jane", "email": "jane@example.com"}
)
user = response.json()["data"]
```

**JavaScript**
```javascript
const response = await fetch("https://api.example.com/v1/users", {
  method: "POST",
  headers: {
    "Authorization": "Bearer YOUR_TOKEN",
    "Content-Type": "application/json"
  },
  body: JSON.stringify({ name: "Jane", email: "jane@example.com" })
});
const { data: user } = await response.json();
```

### Example Quality

Good examples are:
- **Complete**: Can be copied and run
- **Realistic**: Use plausible data
- **Minimal**: No unnecessary complexity
- **Commented**: Explain non-obvious parts
- **Tested**: Actually work with the API

---

## Rate Limiting

### Documentation Requirements

- Request limits per time window
- How limits are calculated
- Rate limit headers
- What happens when exceeded
- How to handle 429 responses

### Example Rate Limit Section

**Limits by Plan**
| Plan | Requests/Minute | Requests/Day |
|------|-----------------|--------------|
| Free | 60 | 1,000 |
| Pro | 300 | 10,000 |
| Enterprise | Custom | Custom |

**Rate Limit Headers**
```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 45
X-RateLimit-Reset: 1642089600
```

**Best Practices**
- Implement exponential backoff
- Cache responses when possible
- Use bulk endpoints to reduce calls

---

## Versioning

### Document Version Strategy

- How versions are indicated (URL, header, query)
- Current version
- Deprecated versions
- Migration guides between versions
- Deprecation timeline

### Example

```
Current version: v2
v1 deprecation: March 2025
v1 end of life: September 2025

Migration guide: /docs/v1-to-v2-migration
```

---

## Webhooks (if applicable)

### Document For Each Webhook

- Event types
- Payload format
- Retry policy
- Security (signature verification)
- Testing webhooks

### Example Webhook Documentation

**Event: user.created**

Triggered when a new user is created.

**Payload**
```json
{
  "event": "user.created",
  "timestamp": "2024-01-15T10:30:00Z",
  "data": {
    "id": "usr_abc123",
    "email": "jane@example.com"
  }
}
```

**Signature Verification**
```python
import hmac
import hashlib

def verify_signature(payload, signature, secret):
    expected = hmac.new(
        secret.encode(),
        payload.encode(),
        hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, signature)
```

---

## Quality Checklist

### Before Publishing

- [ ] All endpoints documented
- [ ] Authentication explained with examples
- [ ] All parameters listed with types and descriptions
- [ ] All response fields documented
- [ ] Error codes and messages listed
- [ ] Code examples in multiple languages
- [ ] Examples are tested and working
- [ ] Rate limits documented
- [ ] Versioning explained
- [ ] Webhooks documented (if applicable)
- [ ] Changelog maintained
