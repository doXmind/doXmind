# Flowchart Templates

## Basic Top-Down Flowchart

```mermaid
graph TD
    A[Start] --> B{Decision?}
    B -->|Yes| C[Action 1]
    B -->|No| D[Action 2]
    C --> E[End]
    D --> E
```

## Left-Right Flowchart

```mermaid
graph LR
    A[Input] --> B[Process]
    B --> C{Valid?}
    C -->|Yes| D[Output]
    C -->|No| E[Error]
    E --> A
```

## Flowchart with Subgraphs

```mermaid
graph TD
    subgraph Frontend
        A[User] --> B[Browser]
        B --> C[React App]
    end
    subgraph Backend
        D[API Server] --> E[Business Logic]
        E --> F[Database]
    end
    C -->|HTTP Request| D
    D -->|Response| C
```

## Multi-Decision Flowchart

```mermaid
graph TD
    Start([Start]) --> Input[/Receive Input/]
    Input --> Validate{Valid?}
    Validate -->|No| Error[Show Error]
    Error --> Input
    Validate -->|Yes| Process[Process Data]
    Process --> Check{Approved?}
    Check -->|Yes| Save[(Save to DB)]
    Check -->|No| Reject[Reject]
    Save --> Notify[Send Notification]
    Notify --> End([End])
    Reject --> End
```

## Non-ASCII Labels (Chinese/Japanese/Korean)

```mermaid
graph TD
    A[开始] --> B{审批?}
    B -->|通过| C[执行操作]
    B -->|拒绝| D[返回修改]
    C --> E[结束]
    D --> A
```

**Note:** Use ASCII IDs (A, B, C) with non-ASCII text in labels: `A[中文标签]`. Prefer ASCII IDs for reliability.

## Expanded Shapes (v11.3.0+)

Use the `@{ shape: name }` syntax for 30+ specialized shapes:

```mermaid
graph TD
    A@{ shape: doc, label: "Document" } --> B@{ shape: dbl-circ, label: "Terminal" }
    C@{ shape: cloud, label: "Cloud" } --> D@{ shape: cyl, label: "Database" }
    E@{ shape: bang, label: "Alert!" } --> F@{ shape: flag, label: "Milestone" }
```

Common shapes: `doc`, `cloud`, `bang`, `flag`, `dbl-circ`, `cyl`, `stadium`, `diam`, `hex`, `rect`, `fr-rect` (subroutine), `hourglass`, `bolt`, `braces`, `tag-rect`, `sm-circ`, `cross-circ`, `card`, `delay`, `multi-doc`, `stored-data`, `text-block`

## Additional Link Types

```mermaid
graph LR
    A[[Subroutine]] --> B(((Double Circle)))
    C ~~~ D
    E --o F
    F --x G
```

- `A ~~~ B` - Invisible link (for layout control, no visible line)
- `A --o B` - Link with circle end
- `A --x B` - Link with cross end
- `A <--> B` - Bidirectional arrow

## Node Shapes Reference

- `[Text]` - Rectangle (process)
- `{Text}` - Diamond (decision)
- `([Text])` - Stadium/pill (start/end)
- `[(Text)]` - Cylinder (database)
- `[/Text/]` - Parallelogram (input/output)
- `((Text))` - Circle
- `>Text]` - Flag
- `{{Text}}` - Hexagon
- `[[Text]]` - Subroutine/subprocess
- `(((Text)))` - Double circle
