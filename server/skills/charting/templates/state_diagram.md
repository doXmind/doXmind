# State Diagram Templates

## Basic State Machine

```mermaid
stateDiagram-v2
    [*] --> Idle
    Idle --> Processing: Start
    Processing --> Done: Complete
    Processing --> Error: Fail
    Error --> Idle: Retry
    Done --> [*]
```

## Order Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Draft
    Draft --> Submitted: Submit
    Submitted --> Processing: Accept
    Submitted --> Rejected: Reject
    Processing --> Shipped: Ship
    Shipped --> Delivered: Confirm delivery
    Delivered --> [*]
    Rejected --> Draft: Revise

    state Processing {
        [*] --> Picking
        Picking --> Packing
        Packing --> ReadyToShip
        ReadyToShip --> [*]
    }
```

## Concurrent States

```mermaid
stateDiagram-v2
    [*] --> Active

    state Active {
        [*] --> Running
        Running --> Paused: Pause
        Paused --> Running: Resume
        --
        [*] --> Monitoring
        Monitoring --> Alerting: Threshold exceeded
        Alerting --> Monitoring: Resolved
    }

    Active --> Stopped: Shutdown
    Stopped --> [*]
```

## Non-ASCII Labels (Chinese/Japanese/Korean)

```mermaid
stateDiagram-v2
    state "空闲" as Idle
    state "处理中" as Processing
    state "已完成" as Done
    state "错误" as Error

    [*] --> Idle
    Idle --> Processing: 开始
    Processing --> Done: 完成
    Processing --> Error: 失败
    Error --> Idle: 重试
    Done --> [*]
```

**Note:** State names in references must be ASCII. Use `state "中文" as id` alias syntax for non-ASCII display. Transition labels after `:` support non-ASCII.

## Direction and Choice States

```mermaid
stateDiagram-v2
    direction LR
    [*] --> Check
    state Check <<choice>>
    Check --> Approved: Valid
    Check --> Rejected: Invalid
    Approved --> [*]
    Rejected --> [*]
```

## Key Syntax

- `[*]` Start or end state
- `-->` Transition with optional label after `:`
- `direction LR` - Set layout direction (LR, RL, TB, BT)
- `state Name { }` Composite state
- `state "Display Name" as id` Alias for non-ASCII display names
- `state name <<choice>>` Decision/choice point
- `state name <<fork>>` / `<<join>>` Fork and join states
- `--` Separator for concurrent regions
- `note right of State` / `note left of State` Multi-line notes (end with `end note`)
