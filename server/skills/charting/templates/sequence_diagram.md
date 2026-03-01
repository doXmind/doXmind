# Sequence Diagram Templates

## Basic Request-Response

```mermaid
sequenceDiagram
    participant C as Client
    participant S as Server
    participant D as Database

    C->>S: HTTP Request
    S->>D: Query
    D-->>S: Results
    S-->>C: HTTP Response
```

## Authentication Flow

```mermaid
sequenceDiagram
    participant U as User
    participant A as App
    participant Auth as Auth Server
    participant API as API Server

    U->>A: Enter credentials
    A->>Auth: POST /login
    Auth->>Auth: Validate credentials
    alt Valid
        Auth-->>A: JWT Token
        A->>API: Request + Token
        API->>API: Verify token
        API-->>A: Protected data
        A-->>U: Show data
    else Invalid
        Auth-->>A: 401 Unauthorized
        A-->>U: Show error
    end
```

## Async Processing

```mermaid
sequenceDiagram
    participant U as User
    participant API as API
    participant Q as Queue
    participant W as Worker

    U->>API: Submit job
    API->>Q: Enqueue task
    API-->>U: Job ID (202 Accepted)

    W->>Q: Poll for tasks
    Q-->>W: Task data
    W->>W: Process task
    W->>API: Update status

    U->>API: Check status
    API-->>U: Job complete
```

## Non-ASCII Labels (Chinese/Japanese/Korean)

```mermaid
sequenceDiagram
    participant U as 用户
    participant A as 应用
    participant S as 服务器

    U->>A: 输入凭证
    A->>S: 验证请求
    S-->>A: 返回结果
    A-->>U: 显示状态
```

**Note:** Participant aliases (U, A, S) must be ASCII. Use `as` for non-ASCII display names: `participant U as 用户`. Message text after `:` supports non-ASCII.

## Bidirectional Arrows (v11.0.0+)

```mermaid
sequenceDiagram
    participant A as Service A
    participant B as Service B

    A <<->> B: Sync bidirectional
    A <<-->> B: Async bidirectional
```

## Actor Creation and Destruction

```mermaid
sequenceDiagram
    participant A as Main Service
    A->>A: Process request
    create participant B as Worker
    A->>B: Spawn worker
    B-->>A: Return result
    destroy B
    B->>A: Terminated
```

## Participant Grouping (Boxing)

```mermaid
sequenceDiagram
    box Backend Services
        participant API as API Server
        participant DB as Database
    end
    box External
        participant Client
    end

    Client->>API: Request
    API->>DB: Query
    DB-->>API: Results
    API-->>Client: Response
```

## Key Syntax

- `->>` Solid line with arrowhead (synchronous)
- `-->>` Dashed line with arrowhead (response/async)
- `--)` Solid line with open arrow
- `<<->>` Bidirectional solid arrow (v11.0.0+)
- `<<-->>` Bidirectional dashed arrow (v11.0.0+)
- `alt/else/end` - Conditional paths
- `loop/end` - Repeated interactions
- `par/and/end` - Parallel execution
- `critical/option/end` - Critical sections with fallbacks
- `rect rgb(r,g,b)/end` - Background highlighting
- `Note over A,B: text` - Notes spanning participants
- `activate/deactivate` - Activation bars
- `autonumber` - Auto-number all messages
- `create participant B` / `destroy B` - Dynamic actor lifecycle
- `box Color Description ... end` - Group participants
- **Non-ASCII:** Use `participant ID as 中文名` for non-ASCII display names
