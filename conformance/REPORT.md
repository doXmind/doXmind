# Markdown → HTML conformance report

Generated from `conformance/corpus.json` by running each importer. Each implementation is pinned by a conformance test (TS: `src/__tests__/extensions/markdown-conformance.test.ts`, Python: `server/tests/test_markdown_conformance.py`, Rust: `crates/sidecar/tests/markdown_conformance.rs`). Refresh a snapshot after an intentional change with `DOXMIND_UPDATE_CONFORMANCE=1` set when running that test.

The three importers feed the same TipTap schema, so they _should_ produce equivalent HTML. They don't yet — this table is the inventory #152 tracks.

- **Agree across all three (16)**: heading, paragraph, emphasis_underscore, bold, strikethrough, inline_code, link_absolute, link_relative, bullet_list, ordered_list, blockquote, fenced_code, mermaid, raw_html_block, html_comment, inline_code_with_math
- **Cosmetic divergence (4)** (different whitespace / attr order / self-close, TipTap parses equivalently): image, table, horizontal_rule, nested_list
- **Semantic divergence (4)** (different node structure or behaviour): task_list, inline_math, block_math, cjk_with_dollar

Resolved since the first inventory: `strikethrough` (Python now registers a GFM
`~~x~~` → `<del>` inline pattern), `nested_list` (Python now runs with
`tab_length=2` so 2-space sublists nest instead of flattening; remaining
difference vs Rust is whitespace only), and `mermaid` (all three importers now
emit the same `<div data-type="mermaid-chart">` node).

## Cosmetic divergences (nested_list)

### `nested_list` — input: `'- a\n  - b'`

All three nest correctly; Rust puts the inner `<ul>` on its own line.

```
rust  : <ul>
<li>a
<ul>
<li>b</li>
</ul>
</li>
</ul>
python: <ul>
<li>a<ul>
<li>b</li>
</ul>
</li>
</ul>
marked: <ul>
<li>a<ul>
<li>b</li>
</ul>
</li>
</ul>
```

## Semantic divergences

### `task_list` — input: `'- [ ] todo\n- [x] done'`

Python emits editor-native `<ul data-type=taskList>`; Rust & marked emit GFM `<input type=checkbox>` (relies on the editor to re-recognise it).

```
rust  : <ul>
<li><input disabled="" type="checkbox"/>
todo</li>
<li><input disabled="" type="checkbox" checked=""/>
done</li>
</ul>
python: <ul data-type="taskList">
<li data-type="taskItem" data-checked="false"><p>todo</p></li>
<li data-type="taskItem" data-checked="true"><p>done</p></li>
</ul>
marked: <ul>
<li><input disabled="" type="checkbox"> todo</li>
<li><input checked="" disabled="" type="checkbox"> done</li>
</ul>
```

### `inline_math` — input: `'energy $E=mc^2$ ok'`

marked converts `$x$` to an inline-math node at import; Rust & Python leave it as text (relies on the editor migration plugin).

```
rust  : <p>energy $E=mc^2$ ok</p>
python: <p>energy $E=mc^2$ ok</p>
marked: <p>energy <span data-type="inline-math" data-latex="E=mc^2" class="inline-math"></span> ok</p>
```

### `block_math` — input: `'$$\nx^2\n$$'`

marked converts `$$..$$` to a block-math node; Rust & Python leave it as text.

```
rust  : <p>$$
x^2
$$</p>
python: <p>$$
x^2
$$</p>
marked: <div data-type="block-math" data-latex="x^2" class="block-math"></div>
```

### `cjk_with_dollar` — input: `'价格是 $5 到 $10 元'`

marked normalises spacing around `$` near CJK differently from Rust/Python.

```
rust  : <p>价格是 $5 到 $10 元</p>
python: <p>价格是 $5 到 $10 元</p>
marked: <p>价格是 $5 到$10 元</p>
```
