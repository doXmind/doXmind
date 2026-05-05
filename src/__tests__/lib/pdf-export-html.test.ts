import { describe, expect, it } from "vitest";

import { prepareHtmlForPdf } from "@/lib/pdf-export-html";

describe("prepareHtmlForPdf", () => {
  it("turns interactive code block chrome into semantic pre/code HTML", async () => {
    const html = `
      <article class="ProseMirror">
        <div class="code-block-wrapper">
          <div class="code-block-container">
            <div class="code-block-header">
              <button>TypeScript</button>
              <button>Copy code</button>
            </div>
            <div class="code-block-body">
              <div class="line-numbers"><div>1</div><div>2</div><div>3</div></div>
              <div><pre class="code-block-content language-typescript">const dir = dirname(markdownPath);
return \`${"${dir}"}/${"${base}"}.doxmind\`;</pre></div>
            </div>
          </div>
        </div>
      </article>
    `;

    const prepared = await prepareHtmlForPdf(html);

    expect(prepared).toContain('class="pdf-code-block"');
    expect(prepared).toContain("TypeScript");
    expect(prepared).toContain("const dir = dirname(markdownPath);");
    expect(prepared).toContain("return `");
    expect(prepared).not.toContain("Copy code");
    expect(prepared).not.toContain("line-numbers");
    expect(prepared).not.toContain("code-block-header");
  });

  it("uses a stashed PNG when the live-DOM rasteriser captured the math block", async () => {
    const html = `
      <article class="ProseMirror">
        <div class="block-math-wrapper" data-pdf-png="data:image/png;base64,AAAA" data-pdf-png-w="320" data-pdf-png-h="48">
          <div class="math-node-wrapper my-4 block">
            <span class="math-rendered">
              <span class="katex">
                <span class="katex-mathml"><math><semantics>
                  <annotation encoding="application/x-tex">a^2 + b^2 = c^2</annotation>
                </semantics></math></span>
              </span>
            </span>
          </div>
        </div>
      </article>
    `;

    const prepared = await prepareHtmlForPdf(html);

    expect(prepared).toContain('class="pdf-math-image"');
    expect(prepared).toContain('src="data:image/png;base64,AAAA"');
    expect(prepared).toContain('width="320"');
    expect(prepared).toContain('height="48"');
    expect(prepared).not.toContain("a^2 + b^2 = c^2");
    expect(prepared).not.toContain("data-pdf-png=");
    expect(prepared).not.toContain("data-pdf-png-w");
    expect(prepared).not.toContain("data-pdf-png-h");
  });

  it("emits a per-image vertical-align style on inline math from the stashed descender so PyMuPDF puts math baseline on text baseline", async () => {
    const html = `
      <article class="ProseMirror">
        <p>
          Inline:
          <span class="inline-math-wrapper" data-pdf-png="data:image/png;base64,DDDD" data-pdf-png-w="84" data-pdf-png-h="22" data-pdf-png-descender-pt="3.40">
            <span class="math-node-wrapper">
              <span class="math-rendered">
                <span class="katex">
                  <span class="katex-mathml"><math><semantics>
                    <annotation encoding="application/x-tex">a^2 + b^2 = c^2</annotation>
                  </semantics></math></span>
                </span>
              </span>
            </span>
          </span>.
        </p>
      </article>
    `;

    const prepared = await prepareHtmlForPdf(html);

    expect(prepared).toContain('class="pdf-math-inline-img"');
    // Per-image vertical-align: image is shifted down by 3.40pt so the
    // captured math baseline (which sits 3.40pt above the PNG bottom) lands
    // on the text baseline.
    expect(prepared).toContain('style="vertical-align: -3.40pt"');
    expect(prepared).not.toContain("data-pdf-png-descender-pt");
  });

  it("omits vertical-align when the rasteriser didn't stash a descender (e.g. fallback path)", async () => {
    const html = `
      <article class="ProseMirror">
        <p>
          Inline:
          <span class="inline-math-wrapper" data-pdf-png="data:image/png;base64,EEEE" data-pdf-png-w="50" data-pdf-png-h="14">
            <span class="math-rendered"></span>
          </span>.
        </p>
      </article>
    `;

    const prepared = await prepareHtmlForPdf(html);

    expect(prepared).toContain('class="pdf-math-inline-img"');
    // No descender stashed → no inline style. The class-level CSS picks up
    // the default `vertical-align: baseline` instead.
    expect(prepared).not.toContain("vertical-align");
  });

  it("sizes inline math <img> from the stashed CSS-pixel dimensions so it doesn't render at native PNG size", async () => {
    const html = `
      <article class="ProseMirror">
        <p>
          Inline:
          <span class="inline-math-wrapper" data-pdf-png="data:image/png;base64,CCCC" data-pdf-png-w="84" data-pdf-png-h="18">
            <span class="math-node-wrapper">
              <span class="math-rendered">
                <span class="katex">
                  <span class="katex-mathml"><math><semantics>
                    <annotation encoding="application/x-tex">a^2 + b^2 = c^2</annotation>
                  </semantics></math></span>
                  <span class="katex-html" aria-hidden="true">a²+b²=c²</span>
                </span>
              </span>
            </span>
          </span>.
        </p>
      </article>
    `;

    const prepared = await prepareHtmlForPdf(html);

    expect(prepared).toContain('class="pdf-math-inline-img"');
    expect(prepared).toContain('src="data:image/png;base64,CCCC"');
    expect(prepared).toContain('width="84"');
    expect(prepared).toContain('height="18"');
    expect(prepared).not.toContain("data-pdf-png=");
  });

  it("uses a stashed PNG when the live-DOM rasteriser captured the mermaid block", async () => {
    const html = `
      <article class="ProseMirror">
        <div class="mermaid-chart-wrapper" data-pdf-png="data:image/png;base64,BBBB" data-pdf-png-w="440" data-pdf-png-h="220" data-code="graph LR; A-->B">
          <div class="mermaid-rendered">
            <svg><style>.foo{fill:red}</style></svg>
          </div>
        </div>
      </article>
    `;

    const prepared = await prepareHtmlForPdf(html);

    expect(prepared).toContain('class="pdf-mermaid"');
    expect(prepared).toContain('src="data:image/png;base64,BBBB"');
    // Explicit pt-sized <img> avoids Story's auto-downscale, which would
    // otherwise wash out small arrow-label glyphs.
    expect(prepared).toContain('width="440"');
    expect(prepared).toContain('height="220"');
    expect(prepared).not.toContain("mermaid-chart-wrapper");
    expect(prepared).not.toContain("data-pdf-png=");
    expect(prepared).not.toContain("data-pdf-png-w");
    expect(prepared).not.toContain("data-pdf-png-h");
    expect(prepared).not.toContain(".foo{fill:red}");
  });

  it("falls back to the mermaid source when no PNG was rasterised", async () => {
    const html = `
      <article class="ProseMirror">
        <div class="mermaid-chart-wrapper" data-code="graph LR; A-->B">
          <div class="mermaid-rendered">
            <svg><style>#mermaid-XX{fill:red}</style></svg>
          </div>
        </div>
      </article>
    `;

    const prepared = await prepareHtmlForPdf(html);

    expect(prepared).toContain('class="pdf-mermaid-fallback"');
    expect(prepared).toContain("graph LR; A--&gt;B");
    expect(prepared).not.toContain("#mermaid-XX{fill:red}");
  });

  it("converts inline math MathML into typeset HTML using <i>/<sup>/<sub> when no PNG was rasterised", async () => {
    // Real KaTeX MathML output for `a^2 + b^2 = c^2`. The rasteriser
    // intentionally skips inline math (its bitmap pipeline drops glyphs);
    // this MathML→HTML path is the one that actually renders inline math
    // in the PDF.
    const html = `
      <article class="ProseMirror">
        <p>
          Inline: the Pythagorean identity is
          <span class="inline-math-wrapper">
            <span class="math-node-wrapper">
              <span class="math-rendered">
                <span class="katex">
                  <span class="katex-mathml">
                    <math xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow>
                      <msup><mi>a</mi><mn>2</mn></msup>
                      <mo>+</mo>
                      <msup><mi>b</mi><mn>2</mn></msup>
                      <mo>=</mo>
                      <msup><mi>c</mi><mn>2</mn></msup>
                    </mrow><annotation encoding="application/x-tex">a^2 + b^2 = c^2</annotation></semantics></math>
                  </span>
                  <span class="katex-html" aria-hidden="true">a²+b²=c²</span>
                </span>
              </span>
            </span>
          </span>.
        </p>
      </article>
    `;

    const prepared = await prepareHtmlForPdf(html);

    expect(prepared).toContain('class="pdf-math-inline-typeset"');
    // Identifiers wrap in <i>; bases stay outside the <sup>.
    expect(prepared).toContain("<i>a</i><sup>2</sup>");
    expect(prepared).toContain("<i>b</i><sup>2</sup>");
    expect(prepared).toContain("<i>c</i><sup>2</sup>");
    // Operators stay upright between the typeset terms.
    expect(prepared).toContain("+");
    expect(prepared).toContain("=");
    // The LaTeX-source fallback (`<code class="pdf-math-inline">`) must NOT
    // be emitted when the MathML walk succeeded — that's the regression
    // we're protecting against.
    expect(prepared).not.toContain('pdf-math-inline"');
    expect(prepared).not.toContain("a^2 + b^2 = c^2");
    // The KaTeX MathML annotation tag and the visual katex-html mirror are
    // both internal and must not leak into the export.
    expect(prepared).not.toContain("annotation");
    expect(prepared).not.toContain("katex-mathml");
    expect(prepared).not.toContain("aria-hidden");
  });

  it("falls back to LaTeX source when MathML uses constructs PyMuPDF can't render (mfrac, msqrt, ...)", async () => {
    // mfrac has no faithful inline mapping in PyMuPDF Story's HTML subset
    // (no <fraction>, no display:flex), so we bail and show the LaTeX.
    const html = `
      <article class="ProseMirror">
        <p>
          Try a fraction:
          <span class="inline-math-wrapper">
            <span class="math-rendered">
              <span class="katex-mathml">
                <math xmlns="http://www.w3.org/1998/Math/MathML"><semantics>
                  <mfrac><mi>a</mi><mi>b</mi></mfrac>
                  <annotation encoding="application/x-tex">\\frac{a}{b}</annotation>
                </semantics></math>
              </span>
            </span>
          </span>.
        </p>
      </article>
    `;

    const prepared = await prepareHtmlForPdf(html);

    expect(prepared).toContain('class="pdf-math-inline"');
    expect(prepared).toContain("\\frac{a}{b}");
    expect(prepared).not.toContain("pdf-math-inline-typeset");
  });

  it("renders multi-letter math identifiers (sin, log, ...) upright when MathML marks them mathvariant=normal", async () => {
    // KaTeX emits `<mi mathvariant="normal">sin</mi>` for function names.
    // Without honouring mathvariant we'd italicise "sin" which is wrong by
    // math typography convention.
    const html = `
      <article class="ProseMirror">
        <p>
          <span class="inline-math-wrapper">
            <span class="math-rendered">
              <span class="katex-mathml">
                <math xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow>
                  <mi mathvariant="normal">sin</mi>
                  <mo>(</mo>
                  <mi>x</mi>
                  <mo>)</mo>
                </mrow><annotation encoding="application/x-tex">\\sin(x)</annotation></semantics></math>
              </span>
            </span>
          </span>
        </p>
      </article>
    `;

    const prepared = await prepareHtmlForPdf(html);

    expect(prepared).toContain('class="pdf-math-inline-typeset"');
    // sin stays upright (no surrounding <i>); single-letter x stays italic.
    expect(prepared).toMatch(/(?<!<i>)sin(?!<\/i>)/);
    expect(prepared).toContain("<i>x</i>");
  });

  it("replaces KaTeX-rendered math with the original LaTeX source when no PNG was rasterised", async () => {
    const html = `
      <article class="ProseMirror">
        <p>
          Inline: the Pythagorean identity is
          <span class="inline-math-wrapper">
            <span class="math-node-wrapper">
              <span class="math-rendered">
                <span class="katex">
                  <span class="katex-mathml">
                    <math><semantics>
                      <annotation encoding="application/x-tex">a^2 + b^2 = c^2</annotation>
                    </semantics></math>
                  </span>
                  <span class="katex-html" aria-hidden="true">a²+b²=c²</span>
                </span>
              </span>
            </span>
          </span>.
        </p>
        <div class="block-math-wrapper">
          <div class="math-node-wrapper my-4 block">
            <span class="math-rendered">
              <span class="katex-display">
                <span class="katex">
                  <span class="katex-mathml">
                    <math><semantics>
                      <annotation encoding="application/x-tex">\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}</annotation>
                    </semantics></math>
                  </span>
                  <span class="katex-html" aria-hidden="true">∫</span>
                </span>
              </span>
            </span>
          </div>
        </div>
      </article>
    `;

    const prepared = await prepareHtmlForPdf(html);

    expect(prepared).toContain('class="pdf-math-inline"');
    expect(prepared).toContain("a^2 + b^2 = c^2");
    expect(prepared).toContain('class="pdf-math-block"');
    expect(prepared).toContain("\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}");
    expect(prepared).not.toContain("annotation");
    expect(prepared).not.toContain("katex-mathml");
    expect(prepared).not.toContain("aria-hidden");
  });

  it("flattens toggles to summary + body without the chevron button", async () => {
    const html = `
      <article class="ProseMirror">
        <div class="notion-toggle-wrapper">
          <div class="notion-toggle is-open" data-toggle-open="true">
            <button aria-label="Collapse toggle">
              <svg class="lucide-chevron-right"></svg>
            </button>
            <div data-toggle-summary>
              <p>Click to expand — sidecar shape</p>
            </div>
            <div data-toggle-body class="notion-toggle-body">
              <div class="notion-toggle-body-content">
                <p>Body line one.</p>
                <p>Body line two.</p>
              </div>
            </div>
          </div>
        </div>
      </article>
    `;

    const prepared = await prepareHtmlForPdf(html);

    expect(prepared).toContain('class="pdf-toggle"');
    expect(prepared).toContain('class="pdf-toggle-summary"');
    expect(prepared).toContain("Click to expand — sidecar shape");
    expect(prepared).toContain('class="pdf-toggle-body"');
    expect(prepared).toContain("Body line one.");
    expect(prepared).toContain("Body line two.");
    expect(prepared).not.toContain("notion-toggle-wrapper");
    expect(prepared).not.toContain("data-toggle-open");
    expect(prepared).not.toContain("lucide-chevron-right");
    expect(prepared).not.toContain("aria-label");
  });

  it("drops the empty-state hint inside an empty toggle body", async () => {
    const html = `
      <article class="ProseMirror">
        <div class="notion-toggle-wrapper">
          <div class="notion-toggle is-closed" data-toggle-open="false">
            <button aria-label="Expand toggle"></button>
            <div data-toggle-summary><p>Heading</p></div>
            <div data-toggle-body class="notion-toggle-body">
              <div class="notion-toggle-body-content"></div>
              <div class="notion-toggle-empty">empty toggle hint</div>
            </div>
          </div>
        </div>
      </article>
    `;

    const prepared = await prepareHtmlForPdf(html);

    expect(prepared).toContain("Heading");
    expect(prepared).not.toContain("empty toggle hint");
    expect(prepared).not.toContain("notion-toggle-empty");
  });

  it("flattens callouts to emoji + content without the picker button", async () => {
    const html = `
      <article class="ProseMirror">
        <div class="doxmind-callout-wrapper">
          <div class="doxmind-callout-card">
            <div class="doxmind-callout-icon-slot relative" contenteditable="false">
              <button class="doxmind-callout-icon-button" title="Change icon">
                <span aria-hidden="true">💡</span>
              </button>
            </div>
            <div class="doxmind-callout-content">
              <p>Callout body.</p>
            </div>
          </div>
        </div>
      </article>
    `;

    const prepared = await prepareHtmlForPdf(html);

    expect(prepared).toContain('class="pdf-callout"');
    expect(prepared).toContain('class="pdf-callout-emoji"');
    expect(prepared).toContain("💡");
    expect(prepared).toContain('class="pdf-callout-content"');
    expect(prepared).toContain("Callout body.");
    expect(prepared).not.toContain("doxmind-callout-icon-button");
    expect(prepared).not.toContain("Change icon");
  });

  it("rewrites a multi-column block into a single-row table for PyMuPDF Story", async () => {
    const html = `
      <article class="ProseMirror">
        <div class="columns-wrapper" data-columns="3">
          <div data-column class="column">
            <h3>Plan</h3>
            <p>Sketch the milestones.</p>
          </div>
          <div data-column class="column">
            <h3>Build</h3>
            <p>Land the boundary.</p>
          </div>
          <div data-column class="column">
            <h3>Verify</h3>
            <p>Round-trip through markdown.</p>
          </div>
        </div>
      </article>
    `;

    const prepared = await prepareHtmlForPdf(html);

    expect(prepared).toContain('class="pdf-columns"');
    expect(prepared).toContain('class="pdf-column"');
    expect(prepared).not.toContain("columns-wrapper");
    expect(prepared).not.toContain('data-column=""');
    // All three columns landed inside one <tr>, in source order, so the PDF
    // backend lays them out side by side instead of stacking them.
    const match = prepared.match(/<tr>([\s\S]*?)<\/tr>/);
    expect(match).not.toBeNull();
    const rowHtml = match![1];
    expect((rowHtml.match(/<td class="pdf-column">/g) || []).length).toBe(3);
    const planIdx = rowHtml.indexOf("Plan");
    const buildIdx = rowHtml.indexOf("Build");
    const verifyIdx = rowHtml.indexOf("Verify");
    expect(planIdx).toBeGreaterThan(-1);
    expect(planIdx).toBeLessThan(buildIdx);
    expect(buildIdx).toBeLessThan(verifyIdx);
    // colgroup widths split the row evenly across the three columns.
    expect((prepared.match(/<col style="width: 33\.3333%"/g) || []).length).toBe(3);
  });

  it("flattens bullet lists into <p class='pdf-list-item'> blocks with • markers and hanging indent", async () => {
    const html = `
      <article class="ProseMirror">
        <ul>
          <li><p>First bullet</p></li>
          <li>
            <p>Second bullet</p>
            <ul>
              <li><p>Nested bullet</p></li>
              <li><p>Another nested bullet</p></li>
            </ul>
          </li>
          <li><p>Third bullet</p></li>
        </ul>
      </article>
    `;

    const prepared = await prepareHtmlForPdf(html);

    // Native list tags are gone — Story's hardcoded ~23pt indent goes with them.
    expect(prepared).not.toMatch(/<ul[\s>]/);
    expect(prepared).not.toMatch(/<li[\s>]/);
    // All five bullets become <p class="pdf-list-item">.
    expect((prepared.match(/class="pdf-list-item"/g) || []).length).toBe(5);
    // Outer items at depth 0: padding-left = 18pt. Nested at depth 1: 36pt.
    // Inline styles because Story ignores class-based padding overrides on <p>.
    expect(prepared).toContain("padding-left:18pt; text-indent:-18pt");
    expect(prepared).toContain("padding-left:36pt; text-indent:-18pt");
    // Marker is a plain inline <span> — NOT display:inline-block, which Story
    // treats as a line-break boundary and would put the bullet on its own line.
    expect(prepared).not.toContain("display:inline-block");
    // Same `•` glyph at every depth so nested doesn't switch to ○.
    const bulletCount = (prepared.match(/>•<\/span>/g) || []).length;
    expect(bulletCount).toBe(5);
    // Item text is preserved.
    expect(prepared).toContain("First bullet");
    expect(prepared).toContain("Nested bullet");
    expect(prepared).toContain("Third bullet");
  });

  it("flattens ordered lists with sequential 1./2./3. markers", async () => {
    const html = `
      <article class="ProseMirror">
        <ol>
          <li><p>Step one</p></li>
          <li><p>Step two — wire the <code>markdown_hash</code> read.</p></li>
          <li><p>Step three</p></li>
        </ol>
      </article>
    `;

    const prepared = await prepareHtmlForPdf(html);

    expect(prepared).not.toMatch(/<ol[\s>]/);
    expect(prepared).toContain(">1.</span>");
    expect(prepared).toContain(">2.</span>");
    expect(prepared).toContain(">3.</span>");
    expect(prepared).toContain("<code>markdown_hash</code>");
  });

  it("rewrites task list <input> markers into Unicode checkbox glyphs inline with item text", async () => {
    const html = `
      <article class="ProseMirror">
        <ul data-type="taskList">
          <li data-checked="true"><label><input type="checkbox" checked /></label><div><p>Sidecar storage boundary</p></div></li>
          <li data-checked="false"><label><input type="checkbox" /></label><div><p>Editor reads sidecar HTML on hash match</p></div></li>
          <li data-checked="false"><label><input type="checkbox" /></label><div><p>Move database-block data into <code>extras.databases</code></p></div></li>
        </ul>
      </article>
    `;

    const prepared = await prepareHtmlForPdf(html);

    // Task list rides the same flattener as bullet/ordered.
    expect((prepared.match(/class="pdf-list-item"/g) || []).length).toBe(3);
    expect(prepared).toContain(">☑</span>"); // checked item
    expect((prepared.match(/>☐<\/span>/g) || []).length).toBe(2); // two open
    expect(prepared).toContain("Sidecar storage boundary");
    expect(prepared).toContain("<code>extras.databases</code>");
    // Editor chrome that Story can't render is fully stripped.
    expect(prepared).not.toContain("<input");
    expect(prepared).not.toContain("<label");
    expect(prepared).not.toContain('data-type="taskList"');
    expect(prepared).not.toContain("data-checked");
  });

  it("rebuilds web bookmarks into a 2-col card table with thumbnail and url-only hyperlink", async () => {
    // Use data: URLs for favicon + thumbnail so transformImages keeps them
    // (external URLs aren't fetchable from the test environment and would
    // be silently dropped — that's the correct production fallback, just
    // not what we're asserting here).
    const fav = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";
    const thumb = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";
    const html = `
      <article class="ProseMirror">
        <div data-type="web-bookmark"
             data-url="https://doxmind.com"
             data-title="doXmind - AI-Native Writing Editor"
             data-description="doXmind is an AI-native writing editor for docs, notes, and knowledge management."
             data-favicon-url="${fav}"
             data-image-url="${thumb}">
          <a href="https://doxmind.com">editor-side react node view content (gets stripped)</a>
        </div>
      </article>
    `;

    const prepared = await prepareHtmlForPdf(html);

    // Card structure
    expect(prepared).toContain('class="pdf-bookmark"');
    expect(prepared).toContain('class="pdf-bookmark-title"');
    expect(prepared).toContain('class="pdf-bookmark-desc"');
    expect(prepared).toContain('class="pdf-bookmark-url"');
    expect(prepared).toContain('class="pdf-bookmark-thumb-img"');
    // Two-column reservation (thumbnail present)
    expect((prepared.match(/<col class="pdf-bookmark-col-/g) || []).length).toBe(2);
    // Text content survives
    expect(prepared).toContain("doXmind - AI-Native Writing Editor");
    expect(prepared).toContain("doXmind is an AI-native writing editor");
    // Only the URL is wrapped in <a> — the title/description must NOT be
    // hyperlinks (which is what made the editor's <a>-wrapped card render
    // as three blue underlined lines in the PDF).
    expect((prepared.match(/<a[\s>]/g) || []).length).toBe(1);
    expect(prepared).toContain('class="pdf-bookmark-url-text"');
    // Editor-side data-* attrs and chrome are gone.
    expect(prepared).not.toContain('data-type="web-bookmark"');
    expect(prepared).not.toContain("editor-side react node view content");
  });

  it("uses a stashed PNG when the live-DOM rasteriser captured the bookmark card", async () => {
    // PyMuPDF Story has no `border-radius`, so the orchestrator rasterises
    // the live editor card to a PNG. When that succeeds, the transform
    // emits `<figure><a><img></a></figure>` instead of the fallback table —
    // pixel-perfect rounded corners + clickable URL.
    const png = "data:image/png;base64,AAAA";
    const html = `
      <article class="ProseMirror">
        <div data-type="web-bookmark"
             data-url="https://doxmind.com"
             data-title="doXmind - AI-Native Writing Editor"
             data-description="An AI-native writing editor."
             data-image-url="https://example.invalid/og.png"
             data-pdf-png="${png}"
             data-pdf-png-w="640"
             data-pdf-png-h="160">
          <a href="https://doxmind.com">editor-side react node view content (gets stripped)</a>
        </div>
      </article>
    `;

    const prepared = await prepareHtmlForPdf(html);

    // Rasterised path: figure wrapping a clickable image, no fallback table.
    expect(prepared).toContain('class="pdf-bookmark-figure"');
    expect(prepared).toContain('<a href="https://doxmind.com">');
    expect(prepared).toContain(`src="${png}"`);
    expect(prepared).toContain('width="640"');
    expect(prepared).toContain('height="160"');
    expect(prepared).not.toContain('class="pdf-bookmark"');
    expect(prepared).not.toContain('class="pdf-bookmark-thumb-img"');
    expect(prepared).not.toContain("editor-side react node view content");
    // Stashed attrs are consumed off the output.
    expect(prepared).not.toContain("data-pdf-png");
  });

  it("drops the thumbnail <img> when the og-image URL can't be fetched", async () => {
    // The transform emits an <img> for any non-empty data-image-url, but
    // transformImages downstream removes the <img> if its src isn't a data:
    // URL and isn't reachable. This is the production fallback for offline
    // exports / unreachable hosts — the rest of the card still renders.
    const html = `
      <article class="ProseMirror">
        <div data-type="web-bookmark"
             data-url="https://doxmind.com"
             data-title="doXmind"
             data-image-url="https://unreachable.invalid/og.png">
        </div>
      </article>
    `;

    const prepared = await prepareHtmlForPdf(html);

    expect(prepared).toContain('class="pdf-bookmark"');
    expect(prepared).toContain("doXmind");
    // No surviving <img> in the bookmark card after the fetch failure.
    expect(prepared).not.toContain('class="pdf-bookmark-thumb-img"');
  });

  it("drops empty web bookmarks (no url) so the editor's empty-state UI doesn't leak into the PDF", async () => {
    const html = `
      <article class="ProseMirror">
        <p>before</p>
        <div data-type="web-bookmark" data-url="" data-title="">
          <div class="empty-state">paste a URL</div>
        </div>
        <p>after</p>
      </article>
    `;

    const prepared = await prepareHtmlForPdf(html);

    expect(prepared).toContain("before");
    expect(prepared).toContain("after");
    expect(prepared).not.toContain("paste a URL");
    expect(prepared).not.toContain("pdf-bookmark");
  });

  it("renders a web bookmark without a thumbnail as a single-column card", async () => {
    const html = `
      <article class="ProseMirror">
        <div data-type="web-bookmark"
             data-url="https://example.org"
             data-title="Example"
             data-description="">
        </div>
      </article>
    `;

    const prepared = await prepareHtmlForPdf(html);

    expect(prepared).toContain('class="pdf-bookmark"');
    expect(prepared).toContain("Example");
    // No <colgroup>/thumbnail when imageUrl is missing — the text column
    // takes the full width.
    expect(prepared).not.toContain("pdf-bookmark-col-");
    expect(prepared).not.toContain("pdf-bookmark-thumb");
  });

  it("drops empty image placeholders that have no <img>", async () => {
    const html = `
      <article class="ProseMirror">
        <p>before</p>
        <div class="image-node-wrapper" data-align="center">
          <div class="doxmind-block-placeholder">
            <span>Add an image</span>
          </div>
        </div>
        <p>after</p>
      </article>
    `;

    const prepared = await prepareHtmlForPdf(html);

    expect(prepared).toContain("before");
    expect(prepared).toContain("after");
    expect(prepared).not.toContain("image-node-wrapper");
    expect(prepared).not.toContain("Add an image");
  });
});
