# Mermaid Syntax Reference

## CRITICAL: Non-ASCII Character Rules

**Many Mermaid parsers only recognize ASCII letters as unquoted text.** Chinese, Japanese, Korean, and other non-ASCII characters require special handling depending on the diagram type.

### Rule 1: Quote non-ASCII text in value positions

Applies to: **titles, axis labels, category names, display text** in:
- `xychart-beta`: title, x-axis labels, y-axis label — ALL must be quoted
- `quadrantChart`: title, axis labels, point names — must be quoted
- `pie`: title must be quoted
- `treemap-beta`: node labels — must be quoted
- `sankey-beta`: source/target names — must be quoted if contains commas
- `packet-beta`: field names — already quoted by syntax


**Example (WRONG):** `xychart-beta` → `title 2026年价格走势`
**Example (CORRECT):** `xychart-beta` → `title "2026年价格走势"`

### Rule 2: IDs must be ASCII — use bracket/label syntax for non-ASCII display

Many diagram types use `id["Label"]` or `id[Label]` syntax where the ID is an internal reference and the label is displayed. **IDs must ALWAYS be ASCII identifiers** (letters, digits, underscore). Put non-ASCII text in the label part only.

This applies to:
- `block-beta`: `a["中文标签"]`, NOT `"中文"["中文标签"]`
- `kanban`: `col1[待办事项]`, NOT `待办[待办事项]`
- `architecture-beta`: `service svc1(server)[服务器]`, NOT `service 服务器(server)[服务器]`

- `flowchart`/`graph`: `A[中文标签]` — flowchart IDs support Unicode but ASCII IDs are safer
- `C4Context` etc.: `Person(user, "用户")` — first param (alias) must be ASCII

### Rule 3: Some diagram types do NOT support non-ASCII names at all

These diagram types have no separate label syntax — identifiers ARE the display text and must be ASCII:
- `classDiagram`: class/method names must be ASCII
- `stateDiagram-v2`: state names must be ASCII
- `erDiagram`: entity/attribute names must be ASCII
- `zenuml`: participant/method names must be ASCII
- `sequenceDiagram`: participant names after `as` must be quoted, but the direct name must be ASCII
- `gitgraph`: branch names must be ASCII

---

## All Diagram Types

| Diagram | Keyword | Status |
|---------|---------|--------|
| Flowchart | `graph` or `flowchart` | Stable |
| Sequence Diagram | `sequenceDiagram` | Stable |
| Class Diagram | `classDiagram` | Stable |
| State Diagram | `stateDiagram-v2` | Stable |
| ER Diagram | `erDiagram` | Stable |
| User Journey | `journey` | Stable |
| Gantt Chart | `gantt` | Stable |
| Pie Chart | `pie` | Stable |
| Quadrant Chart | `quadrantChart` | Stable |
| Requirement Diagram | `requirementDiagram` | Stable |
| GitGraph | `gitgraph` | Stable |
| C4 Diagram | `C4Context` / `C4Container` / `C4Component` / `C4Dynamic` / `C4Deployment` | Stable |
| Mindmap | `mindmap` | Stable |
| Timeline | `timeline` | Stable |
| ZenUML | `zenuml` | Stable |
| Sankey | `sankey-beta` | Beta |
| XY Chart | `xychart-beta` | Beta |
| Block Diagram | `block-beta` | Beta |
| Packet | `packet-beta` | Beta |
| Kanban | `kanban` | Stable |
| Architecture | `architecture-beta` | Beta |

| Treemap | `treemap-beta` | Beta |

---

## Flowchart / Graph

### Direction
- `graph TD` or `graph TB` - Top to bottom
- `graph LR` - Left to right
- `graph BT` - Bottom to top
- `graph RL` - Right to left

### Node Shapes
```
id[Rectangle]       id(Rounded)         id{Diamond}
id([Stadium])       id[(Cylinder)]      id((Circle))
id[/Parallelogram/] id[\Parallelogram\] id[/Trapezoid\]
id>Flag]            id{{Hexagon}}       id[[Subroutine]]
id(((Double Circle)))
```

### Expanded Shapes (v11.3.0+)
```
NodeId@{ shape: shape-name, label: "Text" }
```
Shapes: `doc`, `cloud`, `bang`, `flag`, `dbl-circ`, `cyl`, `stadium`, `diam`, `hex`, `rect`, `fr-rect` (subroutine), `hourglass`, `bolt`, `braces`, `tag-rect`, `sm-circ`, `cross-circ`, `notch-rect`, `trap-t`, `trap-b`, `card`, `collate`, `delay`, `extract`, `fork`, `join`, `loop-limit`, `multi-doc`, `paper-tape`, `stored-data`, `summary`, `text-block`

**Non-ASCII labels:** Use ASCII IDs with label syntax: `A[中文标签]`, `B[日本語]`. Prefer ASCII IDs for reliability.

### Arrow Types
```
A --> B       Solid arrow          A --- B       Solid line
A -.-> B      Dotted arrow         A -.- B       Dotted line
A ==> B       Thick arrow          A === B       Thick line
A --text--> B Arrow with label     A -->|text| B Arrow with label (alt)
A ~~~ B       Invisible link       A --o B       Circle end
A --x B       Cross end            A <--> B      Bidirectional
```

### Edge IDs & Animation (v11.3.0+)
```
e1@--> A --> B              Edge with ID
e1@{ animate: true }        Enable animation (speeds: true, fast, slow)
e1@{ curve: linear }        Per-edge curve style
```

### Subgraphs
```
subgraph Title
    direction LR
    A --> B
end
```

---

## Sequence Diagram

### Messages
```
A->>B: Sync call        A-->>B: Response
A-)B: Async call         A--)B: Async response
A-xB: Failed call        A--xB: Failed response
A<<->>B: Bidirectional   A<<-->>B: Bidirectional dashed (v11.0.0+)
```

### Actor Lifecycle
```
create participant B         Dynamic actor creation
A->>B: Hello
destroy B                    Actor destruction
```

### Participant Grouping
```
box rgba(0,100,200,0.1) Group Name
    participant A
    participant B
end
```

### Control Flow
```
alt/else/end    opt/end    loop/end    par/and/end
critical/option/end    break/end
rect rgb(200,220,255) ... end      Background highlight
autonumber                          Auto-number messages
```

### Other
```
activate A / deactivate A    Note over A,B: text
```

**Non-ASCII:** Participant names must be ASCII. Use alias for display: `participant A as 用户`. Message text after `:` supports non-ASCII.

---

## Class Diagram

**Limitation:** Class names and method names must be ASCII. Non-ASCII characters are not supported in identifiers.

### Visibility
```
+public  -private  #protected  ~internal
```

### Relationships
```
A <|-- B  Inheritance       A <|.. B  Implementation
A *-- B   Composition       A o-- B   Aggregation
A --> B   Association       A ..> B   Dependency
```

---

## State Diagram

**Limitation:** State names must be ASCII. Use `state "中文描述" as s1` alias syntax for non-ASCII display.

```
stateDiagram-v2
    direction LR                    Layout direction (LR, RL, TB, BT)
    [*] --> State1                  Start/End markers
    State1 --> State2: Event        Transition
    state Composite {               Nested states
        [*] --> SubState
    }
    state fork <<fork>>             Fork/Join
    state decision <<choice>>       Decision/choice point
    --                              Concurrent separator
    note right of State1            Notes (multi-line with end note)
        Note text
    end note
```

---

## ER Diagram

**Limitation:** Entity names and attribute names must be ASCII. Non-ASCII identifiers are not supported. Use comments for non-ASCII descriptions.

### Relationships
```
||--||  Exactly one to one      ||--o{  One to zero-many
||--|{  One to one-many         }o--o{  Zero-many to zero-many
```

### Attributes
```
ENTITY { type name PK    type name FK    type name UK }
```

---

## User Journey

```
journey
    title Title
    section Phase Name
        Task name: score: actor1, actor2
```
Score: 1 (worst) to 5 (best). Multiple actors comma-separated.

---

## Gantt Chart

```
gantt
    title Title
    dateFormat YYYY-MM-DD
    axisFormat %b %d
    tickInterval 1week
    excludes weekends
    todayMarker off
    weekend friday                   Weekend start day (v11.0.0+)
    section Section
    Task :id, start, duration
    Task :after id1 id2, duration    Multiple dependencies
    Task :id, until otherId          Run until another task (v10.9.0+)
```
Modifiers: `:active`, `:done`, `:crit`, `:milestone`
Compact mode: `%%{init: {'displayMode': 'compact'}}%%`

**Non-ASCII:** Task IDs (after `:`) must be ASCII. Task names and section names support non-ASCII: `设计阶段 :a1, 2024-01-01, 14d`

---

## Pie Chart

```
pie showData
    title Title
    "Label" : value
```

---

## Quadrant Chart

```
quadrantChart
    title Title
    x-axis Left --> Right
    y-axis Bottom --> Top
    quadrant-1 Top-Right Label
    quadrant-2 Top-Left Label
    quadrant-3 Bottom-Left Label
    quadrant-4 Bottom-Right Label
    Point Name: [x, y]
    Point Name: [x, y] radius: 12
```
x and y range from 0.0 to 1.0. Point styling: `radius`, `stroke-width`, `stroke-color` (avoid `color` — editor theme handles colors).

---

## Requirement Diagram

```
requirementDiagram
    requirement name {
        id: 1
        text: description
        risk: low|medium|high
        verifymethod: analysis|inspection|test|demonstration
    }
    element name { type: ..., docref: ... }
    source - relationship -> target
```
Types: `requirement`, `functionalRequirement`, `interfaceRequirement`, `performanceRequirement`, `physicalRequirement`, `designConstraint`

Relationships: `contains`, `copies`, `derives`, `satisfies`, `verifies`, `refines`, `traces`

---

## GitGraph

```
gitgraph
    commit [id: "id"] [tag: "label"] [type: NORMAL|REVERSE|HIGHLIGHT]
    branch name [order: N]
    checkout name
    merge branch [id: "id"] [tag: "label"]
    cherry-pick id: "commit_id"
```

**Non-ASCII:** Branch names and commit IDs must be ASCII. Tag labels support non-ASCII: `commit tag: "发布版本"`

---

## C4 Diagrams

Keywords: `C4Context`, `C4Container`, `C4Component`, `C4Dynamic`, `C4Deployment`

```
Person(alias, label, descr)            Person_Ext(...)
System(alias, label, descr)            System_Ext(...)
Container(alias, label, techn, descr)  ContainerDb(...)  ContainerQueue(...)
Boundary(alias, label) { ... }
Rel(from, to, label, techn)            BiRel(...)
```

**Non-ASCII:** First param (alias) must be ASCII. Label/description params support non-ASCII: `Person(user, "用户", "系统用户")`

---

## Mindmap

```
mindmap
    root((Central Topic))
        [Square child]
        (Rounded child)
        ((Circle child))
        ))Bang child((
        )Cloud child(
        {{Hexagon child}}
```
Hierarchy by indentation. Icons: `Node::icon(fa fa-book)`

---

## Timeline

```
timeline
    title Title
    section Section Name
        2024 : Event 1
             : Event 2
```

---

## ZenUML

**Limitation:** Participant names and method names must be ASCII.

```
zenuml
    @Actor Alice
    @Database Bob
    Alice->Bob.method() {
        return result
    }
    if(cond) { } else { }
    try { } catch { } finally { }
    par { }
    loop { }
```

---

## Sankey (Beta)

```
sankey-beta
    source,target,value
    source2,target2,value2
```
CSV format. Config: `linkColor`, `nodeAlignment`, `showValues`, `prefix`, `suffix`

---

## XY Chart (Beta)

```
xychart-beta
    title "Title"
    x-axis ["cat1", "cat2", "cat3"]
    y-axis "Label" min --> max
    bar [v1, v2, v3]
    line [v1, v2, v3]
```
Add `horizontal` after `xychart-beta` for horizontal orientation.

**IMPORTANT:** Title and x-axis labels MUST be in double quotes if they contain non-ASCII characters (Chinese, etc.), spaces, or numbers mixed with letters. Always quote to be safe.

---

## Block Diagram (Beta)

```
block-beta
    columns N
    a["Label"]:span  b["Label"]
    block:id:width
        columns N
        ...
    end
    a --> b
```
Shapes: `[""]` square, `("")` round, `[("")]` cylinder, `((""))` circle, `{""}` diamond, `{{""}}` hexagon

**Non-ASCII:** IDs must be ASCII. Use label syntax for non-ASCII display: `a["中文标签"]`, NOT `中文["中文标签"]`

---

## Packet Diagram (Beta)

```
packet-beta
    0-15: "Field Name"       Range syntax
    +16: "Field Name"        Auto-increment syntax
```
Config: `bitsPerRow` (default 32), `showBits`, `rowHeight`

---

## Kanban

```
kanban
    colId[Column Title]
        taskId[Task]@{ assigned: Name, ticket: ID, priority: High }
```
Priority: `Very High`, `High`, `Low`, `Very Low`

**Non-ASCII:** Column/task IDs must be ASCII. Use bracket labels for non-ASCII: `todo[待办事项]`, `t1[设计登录页面]`

---

## Architecture (Beta)

```
architecture-beta
    group id(icon)[Label]
    service id(icon)[Label] in group
    junction id
    service1:Direction --> Direction:service2
```
Directions: `T`, `B`, `L`, `R`. Icons: `cloud`, `database`, `disk`, `internet`, `server`

**Non-ASCII:** Group/service IDs must be ASCII. Use bracket labels for non-ASCII: `service svc1(server)[数据库服务]`

---

## Treemap (Beta)

```
treemap-beta
    "Parent"
        "Child": value
        "Child Group"
            "Grandchild": value
```
Config: `showValues`, `valueFormat`, `padding`
