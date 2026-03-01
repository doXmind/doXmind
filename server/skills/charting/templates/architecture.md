# Architecture Diagram Templates

## Basic Architecture (Beta)

```mermaid
architecture-beta
    group api(cloud)[API Layer]
    group backend(server)[Backend]
    group data(database)[Data Layer]

    service web(internet)[Web Client]
    service gateway(server)[API Gateway] in api
    service auth(server)[Auth Service] in backend
    service app(server)[App Service] in backend
    service db(database)[PostgreSQL] in data
    service cache(disk)[Redis] in data

    web:R --> L:gateway
    gateway:R --> L:auth
    gateway:B --> T:app
    app:R --> L:db
    app:B --> T:cache
```

## Microservices Architecture

```mermaid
architecture-beta
    group frontend(cloud)[Frontend]
    group services(server)[Services]
    group storage(database)[Storage]

    service browser(internet)[Browser] in frontend
    service mobile(internet)[Mobile App] in frontend
    service gateway(server)[API Gateway] in services
    service users(server)[User Service] in services
    service orders(server)[Order Service] in services
    service payments(server)[Payment Service] in services
    service userdb(database)[User DB] in storage
    service orderdb(database)[Order DB] in storage

    browser:B --> T:gateway
    mobile:B --> T:gateway
    gateway:B --> T:users
    gateway:B --> T:orders
    gateway:B --> T:payments
    users:B --> T:userdb
    orders:B --> T:orderdb
```

## Non-ASCII Labels (Chinese/Japanese/Korean)

```mermaid
architecture-beta
    group frontend(cloud)[前端]
    group backend(server)[后端服务]

    service web(internet)[浏览器] in frontend
    service api(server)[API网关] in backend
    service db(database)[数据库] in backend

    web:R --> L:api
    api:R --> L:db
```

**Note:** Group/service IDs must be ASCII (frontend, api, db). Put non-ASCII text in bracket labels: `service api(server)[API网关]`, NOT `service API网关(server)[API网关]`.

## Key Syntax

- `architecture-beta` - Declaration keyword (beta suffix required)
- **Groups**: `group id(icon)[Label]` — IDs must be ASCII, labels support non-ASCII
- **Services**: `service id(icon)[Label]`, place with `in group_id`
- **Junctions**: `junction id` - enable 4-way splits
- **Edges**: `service1:Direction --> Direction:service2`
- **Directions**: `T` (top), `B` (bottom), `L` (left), `R` (right)
- **Arrow types**: `-->` (forward), `<--` (reverse), `---` (no arrow)
- **Built-in icons**: `cloud`, `database`, `disk`, `internet`, `server`
