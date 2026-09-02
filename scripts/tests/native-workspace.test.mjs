import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  createNativeWorkspaceDispatcher,
  NATIVE_WORKSPACE_COMMANDS,
  splitPageSource,
} = require("../../electron/native-workspace.js");
const sourceContract = JSON.parse(
  await fs.readFile(
    new URL("../../tests/fixtures/page-source-contract.json", import.meta.url),
    "utf8"
  )
);
const propertiesContract = JSON.parse(
  await fs.readFile(
    new URL("../../tests/fixtures/page-properties-contract.json", import.meta.url),
    "utf8"
  )
);

async function withWorkspace(run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "doxmind-native-"));
  // DATA_DIR defaults to the real ~/.doxmind, so anything app-private a command writes would
  // otherwise land in the developer's own data.
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "doxmind-native-data-"));
  const previousDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = dataDir;
  try {
    await run(root);
  } finally {
    if (previousDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previousDataDir;
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(dataDir, { recursive: true, force: true });
  }
}

test("Page source corpus has one byte-preserving contract in the Electron runtime", async () => {
  await withWorkspace(async (root) => {
    for (const fixture of sourceContract) {
      await fs.writeFile(path.join(root, fixture.filename), fixture.source, "utf8");
      const split = splitPageSource(fixture.source);
      assert.equal(split.prefix !== null, fixture.frontmatter, fixture.name);
      assert.equal(split.body, fixture.body, fixture.name);
    }

    const invoke = createNativeWorkspaceDispatcher();
    const scan = await invoke("workspace_scan", { root });
    for (const fixture of sourceContract) {
      const read = await invoke("doc_read", { root, path: fixture.filename });
      assert.equal(read.markdown, fixture.body, fixture.name);
      assert.equal(read.meta.id ?? null, fixture.id, fixture.name);
      assert.equal(read.meta.title ?? null, fixture.title, fixture.name);

      const document = scan.documents.find((item) => item.path === fixture.filename);
      assert.ok(document, fixture.name);
      assert.equal(document.idSource, fixture.id === null ? "path" : "frontmatter", fixture.name);
      assert.equal(document.title, fixture.scanTitle, fixture.name);
      assert.equal(await fs.readFile(path.join(root, fixture.filename), "utf8"), fixture.source);
    }
  });
});

test("Page properties obey the shared source-preserving contract", async () => {
  await withWorkspace(async (root) => {
    const invoke = createNativeWorkspaceDispatcher();
    for (const fixture of propertiesContract.safe) {
      await fs.writeFile(path.join(root, fixture.filename), fixture.source, "utf8");
      const opened = await invoke("doc_read", { root, path: fixture.filename });
      assert.deepEqual(opened.meta.tags, fixture.tags, fixture.name);
      assert.deepEqual(opened.meta.aliases, fixture.aliases, fixture.name);
      for (const [key, value] of Object.entries(fixture.properties)) {
        assert.deepEqual(opened.meta[key], value, `${fixture.name}: ${key}`);
      }

      const saved = await invoke("doc_write_workspace", {
        root,
        path: fixture.filename,
        payload: { meta: fixture.patch, expectedRevision: opened.revision },
      });
      assert.equal(saved.markdown, fixture.body, fixture.name);
      for (const [key, value] of Object.entries(fixture.expectedProperties)) {
        assert.deepEqual(saved.meta[key], value, `${fixture.name}: ${key}`);
      }
      assert.equal(
        await fs.readFile(path.join(root, fixture.filename), "utf8"),
        fixture.expectedSource,
        fixture.name
      );
    }

    for (const fixture of propertiesContract.reject) {
      await fs.writeFile(path.join(root, fixture.filename), fixture.source, "utf8");
      await assert.rejects(
        invoke("doc_write_workspace", {
          root,
          path: fixture.filename,
          payload: { meta: fixture.patch },
        }),
        /cannot safely patch Page property/,
        fixture.name
      );
      assert.equal(await fs.readFile(path.join(root, fixture.filename), "utf8"), fixture.source);
    }

    for (const fixture of propertiesContract.invalid) {
      const filename = `${fixture.name}.md`;
      const source = "---\nid: invalid-list\n---\n\nBody\n";
      await fs.writeFile(path.join(root, filename), source, "utf8");
      await assert.rejects(
        invoke("doc_write_workspace", {
          root,
          path: filename,
          payload: { meta: fixture.patch },
        }),
        new RegExp(fixture.error.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
        fixture.name
      );
      assert.equal(await fs.readFile(path.join(root, filename), "utf8"), source);
    }
  });
});

test("workspace image assets are local, typed, bounded, and symlink-free", async () => {
  await withWorkspace(async (root) => {
    const invoke = createNativeWorkspaceDispatcher();
    const assets = path.join(root, "assets");
    await fs.mkdir(assets);
    const png = Buffer.from("89504e470d0a1a0a00000000", "hex");
    await fs.writeFile(path.join(assets, "pixel.png"), png);

    assert.ok(NATIVE_WORKSPACE_COMMANDS.has("workspace_read_asset"));
    assert.deepEqual(await invoke("workspace_read_asset", { root, path: "assets/pixel.png" }), {
      path: "assets/pixel.png",
      mime: "image/png",
      base64: png.toString("base64"),
    });
    for (const [name, mime, bytes] of [
      ["pixel.apng", "image/apng", png],
      ["pixel.bmp", "image/bmp", Buffer.from("424d0000", "hex")],
      ["pixel.ico", "image/x-icon", Buffer.from("000001000000", "hex")],
    ]) {
      await fs.writeFile(path.join(assets, name), bytes);
      assert.deepEqual(await invoke("workspace_read_asset", { root, path: `assets/${name}` }), {
        path: `assets/${name}`,
        mime,
        base64: bytes.toString("base64"),
      });
    }

    await fs.writeFile(path.join(assets, "fake.jpg"), "not a jpeg", "utf8");
    await assert.rejects(
      invoke("workspace_read_asset", { root, path: "assets/fake.jpg" }),
      /content does not match image type/
    );
    await assert.rejects(
      invoke("workspace_read_asset", { root, path: "../outside.png" }),
      /escapes workspace root/
    );

    const real = path.join(root, "real-assets");
    await fs.mkdir(real);
    await fs.writeFile(path.join(real, "linked.png"), png);
    await fs.symlink(real, path.join(root, "linked-assets"));
    await assert.rejects(
      invoke("workspace_read_asset", { root, path: "linked-assets/linked.png" }),
      /symbolic-link image assets are not allowed/
    );
  });
});

test("workspace_import_asset writes a validated raster into assets by default", async () => {
  await withWorkspace(async (root) => {
    const invoke = createNativeWorkspaceDispatcher();
    const png = Buffer.from("89504e470d0a1a0a00000000", "hex");

    assert.ok(NATIVE_WORKSPACE_COMMANDS.has("workspace_import_asset"));
    assert.deepEqual(
      await invoke("workspace_import_asset", {
        root,
        name: "pixel.png",
        bytes: new Uint8Array(png),
      }),
      { path: "assets/pixel.png", mime: "image/png" }
    );
    assert.deepEqual(await fs.readFile(path.join(root, "assets", "pixel.png")), png);
    assert.deepEqual(await fs.readdir(path.join(root, "assets")), ["pixel.png"]);
    assert.deepEqual(await fs.readdir(root), ["assets"]);
  });
});

test("workspace_import_asset keeps existing files and chooses a deterministic collision name", async () => {
  await withWorkspace(async (root) => {
    const invoke = createNativeWorkspaceDispatcher();
    const original = Buffer.from("89504e470d0a1a0a01", "hex");
    const imported = Buffer.from("89504e470d0a1a0a02", "hex");
    await fs.mkdir(path.join(root, "images"));
    await fs.writeFile(path.join(root, "images", "pixel.png"), original);

    assert.deepEqual(
      await invoke("workspace_import_asset", {
        root,
        name: "pixel.png",
        bytes: imported,
        destinationDir: "images",
      }),
      { path: "images/pixel (2).png", mime: "image/png" }
    );
    assert.deepEqual(await fs.readFile(path.join(root, "images", "pixel.png")), original);
    assert.deepEqual(await fs.readFile(path.join(root, "images", "pixel (2).png")), imported);
  });
});

test("workspace_import_asset rejects every symbolic-link destination component", async () => {
  await withWorkspace(async (root) => {
    const invoke = createNativeWorkspaceDispatcher();
    const png = Buffer.from("89504e470d0a1a0a00000000", "hex");
    const realDirectory = path.join(root, "real-assets", "nested");
    await fs.mkdir(realDirectory, { recursive: true });
    await fs.symlink(path.join(root, "real-assets"), path.join(root, "linked-assets"));

    await assert.rejects(
      invoke("workspace_import_asset", {
        root,
        name: "pixel.png",
        bytes: png,
        destinationDir: "linked-assets/nested",
      }),
      /symbolic-link image asset destinations are not allowed/
    );
    assert.deepEqual(await fs.readdir(realDirectory), []);

    const safeAssets = path.join(root, "assets");
    const target = path.join(root, "real.png");
    await fs.mkdir(safeAssets);
    await fs.writeFile(target, png);
    await fs.symlink(target, path.join(safeAssets, "linked.png"));
    await assert.rejects(
      invoke("workspace_import_asset", {
        root,
        name: "linked.png",
        bytes: png,
      }),
      /symbolic-link writes are not allowed/
    );
    assert.deepEqual(await fs.readFile(target), png);
  });
});

test("workspace_import_asset accepts all current raster signatures", async () => {
  await withWorkspace(async (root) => {
    const invoke = createNativeWorkspaceDispatcher();
    const rasterFixtures = [
      ["pixel.apng", "image/apng", Buffer.from("89504e470d0a1a0a00", "hex")],
      ["pixel.png", "image/png", Buffer.from("89504e470d0a1a0a00", "hex")],
      ["pixel.jpg", "image/jpeg", Buffer.from("ffd8ff00", "hex")],
      ["pixel.jpeg", "image/jpeg", Buffer.from("ffd8ff00", "hex")],
      ["pixel.gif", "image/gif", Buffer.from("GIF89a", "ascii")],
      ["pixel.bmp", "image/bmp", Buffer.from("424d00", "hex")],
      ["pixel.ico", "image/x-icon", Buffer.from("00000100", "hex")],
      ["pixel.webp", "image/webp", Buffer.from("524946460000000057454250", "hex")],
      ["pixel.avif", "image/avif", Buffer.from("000000186674797061766966", "hex")],
    ];

    for (const [name, mime, bytes] of rasterFixtures) {
      assert.deepEqual(
        await invoke("workspace_import_asset", {
          root,
          name,
          bytes,
          destinationDir: "raster-assets",
        }),
        { path: `raster-assets/${name}`, mime }
      );
      assert.deepEqual(await fs.readFile(path.join(root, "raster-assets", name)), bytes);
    }
  });
});

test("workspace_import_asset rejects unsupported extensions and mismatched raster bytes", async () => {
  await withWorkspace(async (root) => {
    const invoke = createNativeWorkspaceDispatcher();

    await assert.rejects(
      invoke("workspace_import_asset", {
        root,
        name: "vector.svg",
        bytes: Buffer.from("<svg/>", "utf8"),
      }),
      /unsupported local image type/
    );
    await assert.rejects(
      invoke("workspace_import_asset", {
        root,
        name: "fake.png",
        bytes: Buffer.from("not a png", "utf8"),
      }),
      /content does not match image type/
    );
    for (const name of ["map#one.png", "map?one.png"]) {
      await assert.rejects(
        invoke("workspace_import_asset", {
          root,
          name,
          bytes: Buffer.from("89504e470d0a1a0a", "hex"),
        }),
        /cannot be represented by a Markdown image destination/
      );
    }
    assert.deepEqual(await fs.readdir(root), []);
  });
});

test("workspace_import_asset enforces the inclusive 20 MiB raster boundary", async () => {
  await withWorkspace(async (root) => {
    const invoke = createNativeWorkspaceDispatcher();
    const signature = Buffer.from("89504e470d0a1a0a", "hex");
    const atLimit = Buffer.alloc(20 * 1024 * 1024);
    signature.copy(atLimit);

    assert.deepEqual(
      await invoke("workspace_import_asset", { root, name: "limit.png", bytes: atLimit }),
      { path: "assets/limit.png", mime: "image/png" }
    );
    assert.equal((await fs.stat(path.join(root, "assets", "limit.png"))).size, atLimit.length);

    const overLimit = Buffer.alloc(atLimit.length + 1);
    signature.copy(overLimit);
    await assert.rejects(
      invoke("workspace_import_asset", { root, name: "too-large.png", bytes: overLimit }),
      /must be between 1 byte and 20971520 bytes/
    );
    await assert.rejects(
      invoke("workspace_import_asset", { root, name: "empty.png", bytes: [] }),
      /must be between 1 byte and 20971520 bytes/
    );
    await assert.rejects(fs.access(path.join(root, "assets", "too-large.png")), /ENOENT/);
    await assert.rejects(fs.access(path.join(root, "assets", "empty.png")), /ENOENT/);
  });
});

test("workspace_import_asset confines destination directories and leaf names to the workspace", async () => {
  await withWorkspace(async (root) => {
    const invoke = createNativeWorkspaceDispatcher();
    const png = Buffer.from("89504e470d0a1a0a00", "hex");
    const escapedName = `${path.basename(root)}-escaped-assets`;

    await assert.rejects(
      invoke("workspace_import_asset", { root, name: "../pixel.png", bytes: png }),
      /name must be a file name/
    );
    await assert.rejects(
      invoke("workspace_import_asset", {
        root,
        name: "pixel.png",
        bytes: png,
        destinationDir: `../${escapedName}`,
      }),
      /escapes workspace root/
    );
    await assert.rejects(fs.access(path.join(path.dirname(root), escapedName)), /ENOENT/);
    assert.deepEqual(await fs.readdir(root), []);
  });
});

test("workspace_import_asset uses exclusive creates under concurrent collisions", async () => {
  await withWorkspace(async (root) => {
    const invoke = createNativeWorkspaceDispatcher();
    const firstBytes = Buffer.from("89504e470d0a1a0a01", "hex");
    const secondBytes = Buffer.from("89504e470d0a1a0a02", "hex");

    const [first, second] = await Promise.all([
      invoke("workspace_import_asset", { root, name: "pixel.png", bytes: firstBytes }),
      invoke("workspace_import_asset", { root, name: "pixel.png", bytes: secondBytes }),
    ]);

    assert.deepEqual([first.path, second.path].sort(), [
      "assets/pixel (2).png",
      "assets/pixel.png",
    ]);
    assert.deepEqual(await fs.readFile(path.join(root, first.path)), firstBytes);
    assert.deepEqual(await fs.readFile(path.join(root, second.path)), secondBytes);
  });
});

test("Page property writes add frontmatter only after an explicit property change", async () => {
  await withWorkspace(async (root) => {
    const invoke = createNativeWorkspaceDispatcher();
    await fs.writeFile(path.join(root, "External.md"), "Body\n", "utf8");

    await invoke("doc_write_workspace", {
      root,
      path: "External.md",
      payload: { markdown: "Body changed\n" },
    });
    assert.equal(await fs.readFile(path.join(root, "External.md"), "utf8"), "Body changed\n");

    const saved = await invoke("doc_write_workspace", {
      root,
      path: "External.md",
      payload: { meta: { tags: ["local"] } },
    });
    assert.deepEqual(saved.meta.tags, ["local"]);
    assert.match(saved.meta.id, /^[0-9a-f-]{36}$/);
    assert.match(
      await fs.readFile(path.join(root, "External.md"), "utf8"),
      /^---\nid: [0-9a-f-]{36}\ntags: \["local"\]\n---\n\nBody changed\n$/
    );
    await assert.rejects(fs.access(path.join(root, ".External.doxmind")), /ENOENT/);
  });
});

test("null expectedRevision means no compare-and-swap precondition", async () => {
  await withWorkspace(async (root) => {
    await fs.writeFile(path.join(root, "Nullable.md"), "before");
    const invoke = createNativeWorkspaceDispatcher();

    const saved = await invoke("doc_write_workspace", {
      root,
      path: "Nullable.md",
      payload: { markdown: "after", expectedRevision: null },
    });

    assert.equal(saved.markdown, "after");
    assert.equal(await fs.readFile(path.join(root, "Nullable.md"), "utf8"), "after");
  });
});

test("Page save rechecks its revision after preparing bytes and preserves a concurrent external edit", async () => {
  await withWorkspace(async (root) => {
    const pagePath = path.join(root, "Concurrent.md");
    await fs.writeFile(pagePath, "before", "utf8");
    const canonicalPagePath = await fs.realpath(pagePath);
    const initial = createNativeWorkspaceDispatcher();
    const opened = await initial("doc_read", { root, path: "Concurrent.md" });
    const invoke = createNativeWorkspaceDispatcher({
      beforePageReplace: async (target) => {
        assert.equal(target, canonicalPagePath);
        await fs.writeFile(target, "external edit", "utf8");
      },
    });

    await assert.rejects(
      invoke("doc_write_workspace", {
        root,
        path: "Concurrent.md",
        payload: { markdown: "application edit", expectedRevision: opened.revision },
      }),
      /page_revision_conflict/
    );

    assert.equal(await fs.readFile(pagePath, "utf8"), "external edit");
    assert.deepEqual(await fs.readdir(root), ["Concurrent.md"]);
  });
});

test("Page writes reject non-string Markdown without changing source bytes", async () => {
  await withWorkspace(async (root) => {
    const pagePath = path.join(root, "Typed.md");
    await fs.writeFile(pagePath, "original", "utf8");
    const invoke = createNativeWorkspaceDispatcher();

    await assert.rejects(
      invoke("doc_write_workspace", {
        root,
        path: "Typed.md",
        payload: { markdown: null },
      }),
      /markdown must be a string/i
    );

    assert.equal(await fs.readFile(pagePath, "utf8"), "original");
    assert.deepEqual(await fs.readdir(root), ["Typed.md"]);
  });
});

test("Markdown source copy is byte-exact and never overwrites a destination", async () => {
  await withWorkspace(async (root) => {
    const source = Buffer.from(
      "\ufeff---\r\nid: exact-copy\r\ncustom: [keep, me]\r\n---\r\n\r\nBody\r\n",
      "utf8"
    );
    await fs.writeFile(path.join(root, "Exact.markdown"), source);
    const exportDir = await fs.mkdtemp(path.join(os.tmpdir(), "doxmind-source-copy-"));
    const destination = path.join(exportDir, "Exact copy.md");
    const invoke = createNativeWorkspaceDispatcher();
    try {
      const result = await invoke("doc_copy_source", {
        root,
        path: "Exact.markdown",
        destination,
      });
      assert.deepEqual(result, { path: destination, bytes: source.length });
      assert.deepEqual(await fs.readFile(destination), source);

      await assert.rejects(
        invoke("doc_copy_source", { root, path: "Exact.markdown", destination }),
        /already exists/
      );
      assert.deepEqual(await fs.readFile(destination), source);
      await assert.rejects(
        invoke("doc_copy_source", {
          root,
          path: "Exact.markdown",
          destination: path.join(exportDir, "not-markdown.txt"),
        }),
        /\.md or \.markdown/
      );
    } finally {
      await fs.rm(exportDir, { recursive: true, force: true });
    }
  });
});

test("native Page flow scans, reads, checks revisions, and writes only Markdown", async () => {
  await withWorkspace(async (root) => {
    const pagePath = path.join(root, "Notes.md");
    const sidecarPath = path.join(root, ".Notes.doxmind");
    const original =
      "---\r\nid: note-1\r\ntitle: Old title\r\ncustom: keep me\r\n---\r\n\r\n# Hello\r\n";
    const legacySidecar = Buffer.from([0, 1, 2, 253, 254, 255]);
    await fs.writeFile(pagePath, original);
    await fs.writeFile(sidecarPath, legacySidecar);

    const invoke = createNativeWorkspaceDispatcher();
    const scan = await invoke("workspace_scan", { root });
    assert.equal(scan.root, await fs.realpath(root));
    assert.deepEqual(scan.documents, [
      {
        id: "note-1",
        idSource: "frontmatter",
        path: "Notes.md",
        name: "Notes.md",
        title: "Old title",
        documentType: "markdown",
      },
    ]);

    const read = await invoke("doc_read", { root, path: "Notes.md" });
    assert.equal(read.markdown, "# Hello\r\n");
    assert.match(read.revision, /^sha256:[a-f0-9]{64}$/);
    assert.equal(read.meta.id, "note-1");
    assert.equal(read.meta.custom, "keep me");
    assert.deepEqual(Object.keys(read).sort(), ["markdown", "meta", "outline", "revision"]);

    await assert.rejects(
      invoke("doc_write_workspace", {
        root,
        path: "Notes.md",
        payload: { markdown: "changed", expectedRevision: "sha256:stale" },
      }),
      /page_revision_conflict/
    );

    const saved = await invoke("doc_write_workspace", {
      root,
      path: "Notes.md",
      payload: {
        markdown: "# Saved\r\n",
        meta: { title: "New title", favorite: true },
        expectedRevision: read.revision,
      },
    });
    assert.equal(saved.markdown, "# Saved\r\n");
    assert.notEqual(saved.revision, read.revision);
    assert.deepEqual(Object.keys(saved).sort(), ["markdown", "meta", "outline", "revision"]);
    assert.equal(
      await fs.readFile(pagePath, "utf8"),
      '---\r\nid: note-1\r\ntitle: "New title"\r\ncustom: keep me\r\nfavorite: true\r\n---\r\n\r\n# Saved\r\n'
    );
    assert.deepEqual(await fs.readFile(sidecarPath), legacySidecar);
  });
});

test("native Page paths reject traversal and non-Markdown writes", async () => {
  await withWorkspace(async (root) => {
    const invoke = createNativeWorkspaceDispatcher();
    await assert.rejects(
      invoke("doc_write_workspace", {
        root,
        path: "../escape.md",
        payload: { markdown: "no" },
      }),
      /escapes workspace root/
    );
    await assert.rejects(
      invoke("doc_create", {
        root,
        payload: { path: "Report.pdf", markdown: "not a Page" },
      }),
      /\.md or \.markdown/
    );
  });
});

test("external Pages keep path identity and normal Page operations never create sidecars", async () => {
  await withWorkspace(async (root) => {
    const invoke = createNativeWorkspaceDispatcher();
    const externalPath = path.join(root, "External.markdown");
    await fs.writeFile(externalPath, "# External\n");
    const before = await fs.readFile(externalPath);

    const firstScan = await invoke("workspace_scan", { root });
    const secondScan = await invoke("workspace_scan", { root });
    assert.equal(firstScan.documents[0].idSource, "path");
    assert.equal(firstScan.documents[0].id, secondScan.documents[0].id);
    await invoke("doc_read", { root, path: "External.markdown" });
    assert.deepEqual(await fs.readFile(externalPath), before);
    await assert.rejects(fs.stat(path.join(root, ".External.doxmind")), { code: "ENOENT" });

    await invoke("doc_create", {
      root,
      payload: { path: "Created.md", markdown: "body\n", meta: { id: "created-1" } },
    });
    await invoke("doc_write_workspace", {
      root,
      path: "Created.md",
      payload: { markdown: "saved\n" },
    });
    const names = await fs.readdir(root);
    assert.equal(
      names.some((name) => name.endsWith(".doxmind")),
      false
    );
    assert.equal(
      names.some((name) => name.includes(".tmp-")),
      false
    );
  });
});

test("non-string and empty frontmatter ids stay byte-preserved path identities", async () => {
  await withWorkspace(async (root) => {
    const fixtures = new Map([
      ["Numeric.md", "---\nid: 123\ncustom: numeric\n---\n\nold\n"],
      ["Object.md", '---\nid: {"nested":true}\ncustom: object\n---\n\nold\n'],
      ["Empty.md", '---\nid: ""\ncustom: empty\n---\n\nold\n'],
    ]);
    for (const [name, source] of fixtures) await fs.writeFile(path.join(root, name), source);
    const invoke = createNativeWorkspaceDispatcher();
    const scan = await invoke("workspace_scan", { root });

    for (const [name, source] of fixtures) {
      const document = scan.documents.find((item) => item.name === name);
      assert.equal(document.idSource, "path");
      assert.equal(typeof document.id, "string");
      assert.match(document.id, /^path:/);
      const absolute = path.join(root, name);
      const read = await invoke("doc_read", { root, path: name });
      assert.equal(Object.hasOwn(read.meta, "id"), false);
      assert.equal(await fs.readFile(absolute, "utf8"), source);

      await invoke("doc_write_workspace", {
        root,
        path: name,
        payload: {
          markdown: "new\n",
          meta: { id: document.id },
          expectedRevision: read.revision,
        },
      });
      assert.equal(await fs.readFile(absolute, "utf8"), source.replace("old\n", "new\n"));
    }
  });
});

test("portable Page identity handles BOM, CRLF, and YAML comments without rewriting them", async () => {
  await withWorkspace(async (root) => {
    const invoke = createNativeWorkspaceDispatcher();
    const pagePath = path.join(root, "Portable.md");
    const original = Buffer.from(
      "\ufeff---\r\nid: page-1 # portable id\r\ntitle: Demo # visible title\r\ncustom: [keep, exact]\r\n---\r\n\r\n# Body\r\n",
      "utf8"
    );
    await fs.writeFile(pagePath, original);

    const scan = await invoke("workspace_scan", { root });
    assert.equal(scan.documents[0].id, "page-1");
    assert.equal(scan.documents[0].idSource, "frontmatter");
    assert.equal(scan.documents[0].title, "Demo");

    const read = await invoke("doc_read", { root, path: "Portable.md" });
    assert.equal(read.meta.id, "page-1");
    assert.equal(read.meta.title, "Demo");
    assert.equal(read.markdown, "# Body\r\n");
    await invoke("doc_write_workspace", {
      root,
      path: "Portable.md",
      payload: {
        markdown: "# Saved\r\n",
        meta: { favorite: true },
        expectedRevision: read.revision,
      },
    });

    const saved = await fs.readFile(pagePath);
    assert.deepEqual(saved.subarray(0, 3), Buffer.from([0xef, 0xbb, 0xbf]));
    assert.match(saved.toString("utf8"), /id: page-1 # portable id\r\n/);
    assert.match(saved.toString("utf8"), /title: Demo # visible title\r\n/);
    assert.match(saved.toString("utf8"), /custom: \[keep, exact\]\r\n/);
    assert.match(saved.toString("utf8"), /favorite: true\r\n---\r\n\r\n# Saved\r\n$/);
  });
});

test("duplicate authored Page ids fall back to distinct path identities", async () => {
  await withWorkspace(async (root) => {
    const invoke = createNativeWorkspaceDispatcher();
    for (const name of ["A.md", "B.md"]) {
      await fs.writeFile(path.join(root, name), `---\nid: copied-page\n---\n\nneedle ${name}\n`);
    }

    const scan = await invoke("workspace_scan", { root });
    assert.deepEqual(
      scan.documents.map(({ idSource }) => idSource),
      ["path", "path"]
    );
    assert.equal(new Set(scan.documents.map(({ id }) => id)).size, 2);
    assert.ok(scan.documents.every(({ id }) => id.startsWith("path:")));

    const search = await invoke("workspace_markdown_search", { root, query: "needle" });
    assert.deepEqual(
      new Map(search.map(({ path: relPath, id }) => [relPath, id])),
      new Map(scan.documents.map(({ path: relPath, id }) => [relPath, id]))
    );
  });
});

test("native tree operations move and trash legacy sidecars without changing their bytes", async () => {
  await withWorkspace(async (root) => {
    const trash = await fs.mkdtemp(path.join(os.tmpdir(), "doxmind-native-trash-"));
    try {
      const trashed = [];
      const invoke = createNativeWorkspaceDispatcher({
        trashItem: async (source) => {
          const destination = path.join(trash, `${trashed.length}-${path.basename(source)}`);
          await fs.rename(source, destination);
          trashed.push(destination);
        },
      });
      await invoke("workspace_create_folder", { root, path: "Projects" });
      await fs.writeFile(path.join(root, "Draft.pdf"), "%PDF-1.4\n");

      const sidecarFamily = new Map([
        ["", Buffer.from([9, 8, 7, 0, 255])],
        [".bak", Buffer.from("backup")],
        [".lock", Buffer.from("lock")],
        [".corrupt-2026-07-21", Buffer.from("forensic")],
      ]);
      for (const [suffix, bytes] of sidecarFamily) {
        await fs.writeFile(path.join(root, `.Draft.pdf.doxmind${suffix}`), bytes);
      }
      const renamed = await invoke("doc_rename", {
        root,
        oldPath: "Draft.pdf",
        newPath: "Plan.pdf",
      });
      assert.equal(renamed.path, "Plan.pdf");
      for (const [suffix, bytes] of sidecarFamily) {
        assert.deepEqual(await fs.readFile(path.join(root, `.Plan.pdf.doxmind${suffix}`)), bytes);
      }

      const moved = await invoke("doc_move", {
        root,
        oldPath: "Plan.pdf",
        newPath: "Projects/Plan.pdf",
      });
      assert.equal(moved.kind, "document");
      assert.equal(moved.path, "Projects/Plan.pdf");
      for (const [suffix, bytes] of sidecarFamily) {
        assert.deepEqual(
          await fs.readFile(path.join(root, "Projects", `.Plan.pdf.doxmind${suffix}`)),
          bytes
        );
      }

      const deleted = await invoke("doc_delete", { root, path: "Projects/Plan.pdf" });
      assert.equal(deleted.sidecarPath, "Projects/.Plan.pdf.doxmind");
      assert.equal(trashed.length, 1 + sidecarFamily.size);
      const trashedFamily = new Map(
        trashed
          .slice(1)
          .map((trashedPath) => [
            path.basename(trashedPath).replace(/^\d+-\.Plan\.pdf\.doxmind/, ""),
            trashedPath,
          ])
      );
      for (const [suffix, bytes] of sidecarFamily) {
        assert.deepEqual(await fs.readFile(trashedFamily.get(suffix)), bytes);
      }
      await assert.rejects(fs.stat(path.join(root, "Projects", "Plan.pdf")), { code: "ENOENT" });

      await fs.writeFile(path.join(root, "Projects", ".legacy.doxmind"), sidecarFamily.get(""));
      await invoke("workspace_relocate_folder", {
        root,
        oldPath: "Projects",
        newPath: "Renamed",
        checks: [],
        writes: [],
      });
      const folderMove = await invoke("workspace_relocate_folder", {
        root,
        oldPath: "Renamed",
        newPath: "Archive",
        checks: [],
        writes: [],
      });
      assert.deepEqual(folderMove, { path: "Archive", writes: [] });
      await invoke("workspace_delete_folder", { root, path: "Archive" });
      assert.deepEqual(
        await fs.readFile(path.join(trashed[1 + sidecarFamily.size], ".legacy.doxmind")),
        sidecarFamily.get("")
      );
    } finally {
      await fs.rm(trash, { recursive: true, force: true });
    }
  });
});

test("document moves preflight every legacy-family destination before mutating", async () => {
  await withWorkspace(async (root) => {
    const invoke = createNativeWorkspaceDispatcher();
    await fs.writeFile(path.join(root, "Source.pdf"), "source");
    await fs.writeFile(path.join(root, ".Source.pdf.doxmind.bak"), "source backup");
    await fs.writeFile(path.join(root, ".Taken.pdf.doxmind.lock"), "destination lock");
    await assert.rejects(
      invoke("doc_rename", { root, oldPath: "Source.pdf", newPath: "Taken.pdf" }),
      /destination sidecar family already exists/
    );
    assert.equal(await fs.readFile(path.join(root, "Source.pdf"), "utf8"), "source");
    assert.equal(
      await fs.readFile(path.join(root, ".Source.pdf.doxmind.bak"), "utf8"),
      "source backup"
    );
    await assert.rejects(fs.stat(path.join(root, "Taken.pdf")), { code: "ENOENT" });
  });
});

test("a failed legacy-family move rolls every already-moved member back", async () => {
  await withWorkspace(async (root) => {
    await fs.writeFile(path.join(root, "Rollback.pdf"), "source");
    await fs.writeFile(path.join(root, ".Rollback.pdf.doxmind"), "sidecar");
    await fs.writeFile(path.join(root, ".Rollback.pdf.doxmind.bak"), "backup");
    let injected = false;
    const invoke = createNativeWorkspaceDispatcher({
      renamePath: async (source, destination) => {
        if (!injected && source.endsWith(".Rollback.pdf.doxmind.bak")) {
          injected = true;
          throw new Error("injected move failure");
        }
        await fs.rename(source, destination);
      },
    });
    await assert.rejects(
      invoke("doc_move", {
        root,
        oldPath: "Rollback.pdf",
        newPath: "Nested/Rollback.pdf",
      }),
      /rolled back/
    );
    assert.equal(await fs.readFile(path.join(root, "Rollback.pdf"), "utf8"), "source");
    assert.equal(await fs.readFile(path.join(root, ".Rollback.pdf.doxmind"), "utf8"), "sidecar");
    assert.equal(await fs.readFile(path.join(root, ".Rollback.pdf.doxmind.bak"), "utf8"), "backup");
    await assert.rejects(fs.stat(path.join(root, "Nested")), { code: "ENOENT" });
  });
});

test("legacy structural commands cannot bypass Page or Folder relocation", async () => {
  await withWorkspace(async (root) => {
    const invoke = createNativeWorkspaceDispatcher();
    await fs.writeFile(path.join(root, "Page.md"), "# Page\n");
    await fs.mkdir(path.join(root, "Notes"));

    await assert.rejects(
      invoke("doc_rename", { root, oldPath: "Page.md", newPath: "Renamed.md" }),
      /workspace_relocate_page/
    );
    await assert.rejects(
      invoke("doc_move", { root, oldPath: "Page.md", newPath: "Notes/Page.md" }),
      /workspace_relocate_page/
    );
    await assert.rejects(
      invoke("doc_move", { root, oldPath: "Notes", newPath: "Archive/Notes" }),
      /workspace_relocate_folder/
    );
    await assert.rejects(
      invoke("workspace_rename_folder", { root, oldPath: "Notes", newPath: "Archive" }),
      /unsupported native workspace command/
    );

    assert.equal(await fs.readFile(path.join(root, "Page.md"), "utf8"), "# Page\n");
    assert.equal((await fs.stat(path.join(root, "Notes"))).isDirectory(), true);
  });
});

test("Page relocation commits the legacy family and revision-checked Markdown repairs together", async () => {
  await withWorkspace(async (root) => {
    const invoke = createNativeWorkspaceDispatcher();
    await fs.mkdir(path.join(root, "Notes"));
    const targetSource = "---\nid: target-1\n---\n\n# Target\n";
    const dailySource = "---\nid: daily-1\ncustom: keep\n---\n\nSee [[Target]].\n";
    await fs.writeFile(path.join(root, "Notes", "Target.md"), targetSource);
    await fs.writeFile(path.join(root, "Notes", "Daily.md"), dailySource);
    const recoveryBytes = Buffer.from([0, 9, 8, 255]);
    await fs.writeFile(path.join(root, "Notes", ".Target.doxmind"), recoveryBytes);
    const target = await invoke("doc_read", { root, path: "Notes/Target.md" });
    const daily = await invoke("doc_read", { root, path: "Notes/Daily.md" });

    const relocated = await invoke("workspace_relocate_page", {
      root,
      oldPath: "Notes/Target.md",
      newPath: "Archive/Roadmap.md",
      expectedRevision: target.revision,
      checks: [
        { path: "Notes/Daily.md", expectedRevision: daily.revision },
        { path: "Notes/Target.md", expectedRevision: target.revision },
      ],
      movedMarkdown: "# Roadmap\n",
      writes: [
        {
          path: "Notes/Daily.md",
          expectedRevision: daily.revision,
          markdown: "See [[../Archive/Roadmap]].\n",
        },
      ],
    });

    assert.equal(relocated.document.path, "Archive/Roadmap.md");
    assert.notEqual(relocated.revision, target.revision);
    assert.equal(relocated.writes.length, 1);
    assert.equal(relocated.writes[0].path, "Notes/Daily.md");
    assert.equal(
      await fs.readFile(path.join(root, "Notes", "Daily.md"), "utf8"),
      "---\nid: daily-1\ncustom: keep\n---\n\nSee [[../Archive/Roadmap]].\n"
    );
    assert.deepEqual(
      await fs.readFile(path.join(root, "Archive", ".Roadmap.doxmind")),
      recoveryBytes
    );
    assert.equal(
      await fs.readFile(path.join(root, "Archive", "Roadmap.md"), "utf8"),
      "---\nid: target-1\n---\n\n# Roadmap\n"
    );
    await assert.rejects(fs.stat(path.join(root, "Notes", "Target.md")), { code: "ENOENT" });
  });
});

test("Page relocation rejects a stale repair plan before moving any source bytes", async () => {
  await withWorkspace(async (root) => {
    const invoke = createNativeWorkspaceDispatcher();
    await fs.writeFile(path.join(root, "Target.md"), "---\nid: target-1\n---\n\nTarget\n");
    await fs.writeFile(path.join(root, "Daily.md"), "---\nid: daily-1\n---\n\n[[Target]]\n");
    await fs.writeFile(path.join(root, ".Target.doxmind.lock"), "lock");
    const target = await invoke("doc_read", { root, path: "Target.md" });
    const daily = await invoke("doc_read", { root, path: "Daily.md" });
    await fs.appendFile(path.join(root, "Daily.md"), "external\n");

    await assert.rejects(
      invoke("workspace_relocate_page", {
        root,
        oldPath: "Target.md",
        newPath: "Archive/Roadmap.md",
        expectedRevision: target.revision,
        checks: [
          { path: "Daily.md", expectedRevision: daily.revision },
          { path: "Target.md", expectedRevision: target.revision },
        ],
        writes: [
          {
            path: "Daily.md",
            expectedRevision: daily.revision,
            markdown: "[[Archive/Roadmap]]\n",
          },
        ],
      }),
      /page_revision_conflict/
    );

    assert.match(await fs.readFile(path.join(root, "Daily.md"), "utf8"), /external\n$/);
    assert.equal(
      await fs.readFile(path.join(root, "Target.md"), "utf8"),
      "---\nid: target-1\n---\n\nTarget\n"
    );
    assert.equal(await fs.readFile(path.join(root, ".Target.doxmind.lock"), "utf8"), "lock");
    await assert.rejects(fs.stat(path.join(root, "Archive")), { code: "ENOENT" });
  });
});

test("Page relocation rejects a Page added after the complete topology snapshot", async () => {
  await withWorkspace(async (root) => {
    const invoke = createNativeWorkspaceDispatcher();
    const targetSource = "---\nid: target-1\n---\n\nTarget\n";
    const dailySource = "---\nid: daily-1\n---\n\n[[Target]]\n";
    await fs.writeFile(path.join(root, "Target.md"), targetSource);
    await fs.writeFile(path.join(root, "Daily.md"), dailySource);
    const target = await invoke("doc_read", { root, path: "Target.md" });
    const daily = await invoke("doc_read", { root, path: "Daily.md" });
    await fs.writeFile(path.join(root, "Late.md"), "[[Target]]\n");

    await assert.rejects(
      invoke("workspace_relocate_page", {
        root,
        oldPath: "Target.md",
        newPath: "Archive/Roadmap.md",
        expectedRevision: target.revision,
        checks: [
          { path: "Daily.md", expectedRevision: daily.revision },
          { path: "Target.md", expectedRevision: target.revision },
        ],
        writes: [],
      }),
      /unplanned Pages Late\.md/
    );

    assert.equal(await fs.readFile(path.join(root, "Target.md"), "utf8"), targetSource);
    assert.equal(await fs.readFile(path.join(root, "Daily.md"), "utf8"), dailySource);
    await assert.rejects(fs.stat(path.join(root, "Archive")), { code: "ENOENT" });
  });
});

test("Page relocation rolls back repaired Pages and the complete legacy family on write failure", async () => {
  await withWorkspace(async (root) => {
    let injected = false;
    const invoke = createNativeWorkspaceDispatcher({
      writePageBytes: async (target, bytes) => {
        if (!injected && target.endsWith(`${path.sep}Second.md`)) {
          injected = true;
          throw new Error("injected repair failure");
        }
        await fs.writeFile(target, bytes);
      },
    });
    const targetSource = "---\nid: target-1\n---\n\nTarget\n";
    const firstSource = "---\nid: first-1\n---\n\n[[Target]]\n";
    const secondSource = "---\nid: second-1\n---\n\n[[Target]]\n";
    await fs.writeFile(path.join(root, "Target.md"), targetSource);
    await fs.writeFile(path.join(root, "First.md"), firstSource);
    await fs.writeFile(path.join(root, "Second.md"), secondSource);
    await fs.writeFile(path.join(root, ".Target.doxmind.bak"), "backup");
    const target = await invoke("doc_read", { root, path: "Target.md" });
    const first = await invoke("doc_read", { root, path: "First.md" });
    const second = await invoke("doc_read", { root, path: "Second.md" });

    await assert.rejects(
      invoke("workspace_relocate_page", {
        root,
        oldPath: "Target.md",
        newPath: "Archive/Roadmap.md",
        expectedRevision: target.revision,
        checks: [
          { path: "First.md", expectedRevision: first.revision },
          { path: "Second.md", expectedRevision: second.revision },
          { path: "Target.md", expectedRevision: target.revision },
        ],
        writes: [
          {
            path: "First.md",
            expectedRevision: first.revision,
            markdown: "[[Archive/Roadmap]]\n",
          },
          {
            path: "Second.md",
            expectedRevision: second.revision,
            markdown: "[[Archive/Roadmap]]\n",
          },
        ],
      }),
      /rolled back/
    );

    assert.equal(await fs.readFile(path.join(root, "Target.md"), "utf8"), targetSource);
    assert.equal(await fs.readFile(path.join(root, "First.md"), "utf8"), firstSource);
    assert.equal(await fs.readFile(path.join(root, "Second.md"), "utf8"), secondSource);
    assert.equal(await fs.readFile(path.join(root, ".Target.doxmind.bak"), "utf8"), "backup");
    await assert.rejects(fs.stat(path.join(root, "Archive")), { code: "ENOENT" });
  });
});

test("Folder relocation commits subtree and external Page link repairs together", async () => {
  await withWorkspace(async (root) => {
    const invoke = createNativeWorkspaceDispatcher();
    await fs.mkdir(path.join(root, "Notes"));
    const targetSource = "---\nid: target-1\n---\n\n[[../Daily]]\n";
    const dailySource = "---\nid: daily-1\ncustom: keep\n---\n\n[[Notes/Target]]\n";
    await fs.writeFile(path.join(root, "Notes", "Target.md"), targetSource);
    await fs.writeFile(path.join(root, "Daily.md"), dailySource);
    await fs.writeFile(path.join(root, "Notes", ".Target.doxmind.lock"), "lock");
    const target = await invoke("doc_read", { root, path: "Notes/Target.md" });
    const daily = await invoke("doc_read", { root, path: "Daily.md" });

    const relocated = await invoke("workspace_relocate_folder", {
      root,
      oldPath: "Notes",
      newPath: "Archive/Notes",
      checks: [
        { path: "Daily.md", expectedRevision: daily.revision },
        { path: "Notes/Target.md", expectedRevision: target.revision },
      ],
      writes: [
        {
          sourcePath: "Notes/Target.md",
          destinationPath: "Archive/Notes/Target.md",
          expectedRevision: target.revision,
          markdown: "[[../../Daily]]\n",
        },
        {
          sourcePath: "Daily.md",
          destinationPath: "Daily.md",
          expectedRevision: daily.revision,
          markdown: "[[Archive/Notes/Target]]\n",
        },
      ],
    });

    assert.equal(relocated.path, "Archive/Notes");
    assert.deepEqual(
      relocated.writes.map((write) => write.path),
      ["Archive/Notes/Target.md", "Daily.md"]
    );
    assert.equal(
      await fs.readFile(path.join(root, "Archive", "Notes", "Target.md"), "utf8"),
      "---\nid: target-1\n---\n\n[[../../Daily]]\n"
    );
    assert.equal(
      await fs.readFile(path.join(root, "Daily.md"), "utf8"),
      "---\nid: daily-1\ncustom: keep\n---\n\n[[Archive/Notes/Target]]\n"
    );
    assert.equal(
      await fs.readFile(path.join(root, "Archive", "Notes", ".Target.doxmind.lock"), "utf8"),
      "lock"
    );
    await assert.rejects(fs.stat(path.join(root, "Notes")), { code: "ENOENT" });
  });
});

test("Folder relocation rejects a stale topology check before moving the subtree", async () => {
  await withWorkspace(async (root) => {
    const invoke = createNativeWorkspaceDispatcher();
    await fs.mkdir(path.join(root, "Notes"));
    await fs.writeFile(path.join(root, "Notes", "Target.md"), "Target\n");
    await fs.writeFile(path.join(root, "Daily.md"), "[[Notes/Target]]\n");
    const target = await invoke("doc_read", { root, path: "Notes/Target.md" });
    const daily = await invoke("doc_read", { root, path: "Daily.md" });
    await fs.appendFile(path.join(root, "Daily.md"), "external\n");

    await assert.rejects(
      invoke("workspace_relocate_folder", {
        root,
        oldPath: "Notes",
        newPath: "Archive/Notes",
        checks: [
          { path: "Daily.md", expectedRevision: daily.revision },
          { path: "Notes/Target.md", expectedRevision: target.revision },
        ],
        writes: [],
      }),
      /page_revision_conflict/
    );

    assert.equal(await fs.readFile(path.join(root, "Notes", "Target.md"), "utf8"), "Target\n");
    assert.match(await fs.readFile(path.join(root, "Daily.md"), "utf8"), /external\n$/);
    await assert.rejects(fs.stat(path.join(root, "Archive")), { code: "ENOENT" });
  });
});

test("Folder relocation rejects a Page added after the complete topology snapshot", async () => {
  await withWorkspace(async (root) => {
    const invoke = createNativeWorkspaceDispatcher();
    await fs.mkdir(path.join(root, "Notes"));
    await fs.writeFile(path.join(root, "Notes", "Target.md"), "Target\n");
    const target = await invoke("doc_read", { root, path: "Notes/Target.md" });
    await fs.writeFile(path.join(root, "Late.md"), "[[Notes/Target]]\n");

    await assert.rejects(
      invoke("workspace_relocate_folder", {
        root,
        oldPath: "Notes",
        newPath: "Archive/Notes",
        checks: [{ path: "Notes/Target.md", expectedRevision: target.revision }],
        writes: [],
      }),
      /unplanned Pages Late\.md/
    );

    assert.equal(await fs.readFile(path.join(root, "Notes", "Target.md"), "utf8"), "Target\n");
    await assert.rejects(fs.stat(path.join(root, "Archive")), { code: "ENOENT" });
  });
});

test("Folder relocation restores the subtree and repaired Pages after a write failure", async () => {
  await withWorkspace(async (root) => {
    let injected = false;
    const invoke = createNativeWorkspaceDispatcher({
      writePageBytes: async (target, bytes) => {
        if (!injected && target.endsWith(`${path.sep}Daily.md`)) {
          injected = true;
          throw new Error("injected folder repair failure");
        }
        await fs.writeFile(target, bytes);
      },
    });
    await fs.mkdir(path.join(root, "Notes"));
    const targetSource = "---\nid: target-1\n---\n\n[[../Daily]]\n";
    const dailySource = "---\nid: daily-1\n---\n\n[[Notes/Target]]\n";
    await fs.writeFile(path.join(root, "Notes", "Target.md"), targetSource);
    await fs.writeFile(path.join(root, "Notes", ".Target.doxmind.bak"), "backup");
    await fs.writeFile(path.join(root, "Daily.md"), dailySource);
    const target = await invoke("doc_read", { root, path: "Notes/Target.md" });
    const daily = await invoke("doc_read", { root, path: "Daily.md" });

    await assert.rejects(
      invoke("workspace_relocate_folder", {
        root,
        oldPath: "Notes",
        newPath: "Archive/Notes",
        checks: [
          { path: "Daily.md", expectedRevision: daily.revision },
          { path: "Notes/Target.md", expectedRevision: target.revision },
        ],
        writes: [
          {
            sourcePath: "Notes/Target.md",
            destinationPath: "Archive/Notes/Target.md",
            expectedRevision: target.revision,
            markdown: "[[../../Daily]]\n",
          },
          {
            sourcePath: "Daily.md",
            destinationPath: "Daily.md",
            expectedRevision: daily.revision,
            markdown: "[[Archive/Notes/Target]]\n",
          },
        ],
      }),
      /rolled back/
    );

    assert.equal(await fs.readFile(path.join(root, "Notes", "Target.md"), "utf8"), targetSource);
    assert.equal(await fs.readFile(path.join(root, "Daily.md"), "utf8"), dailySource);
    assert.equal(
      await fs.readFile(path.join(root, "Notes", ".Target.doxmind.bak"), "utf8"),
      "backup"
    );
    await assert.rejects(fs.stat(path.join(root, "Archive")), { code: "ENOENT" });
  });
});

test("native workspace searches Pages and imports attachments without a backend", async () => {
  await withWorkspace(async (root) => {
    const invoke = createNativeWorkspaceDispatcher();
    await fs.writeFile(path.join(root, "Page.md"), "# Alpha\nneedle here\n");

    const search = await invoke("workspace_markdown_search", {
      root,
      query: "NEEDLE",
      limit: 5,
    });
    assert.equal(search.length, 1);
    assert.equal(search[0].matches[0].line, 2);

    const markdown = Buffer.from("# Knowledge\n\nlinked note\n", "utf8");
    const importedPage = await invoke("doc_import_external", {
      root,
      name: "Knowledge.markdown",
      destFolder: "",
      mode: "create",
      bytes: [...markdown],
    });
    assert.equal(importedPage.documentType, "markdown");
    assert.equal(importedPage.path, "Knowledge.markdown");
    assert.deepEqual(await fs.readFile(path.join(root, "Knowledge.markdown")), markdown);

    const pdf = Buffer.from("%PDF-1.7\nlocal bytes", "latin1");
    const imported = await invoke("doc_import_external", {
      root,
      name: "Spec.pdf",
      destFolder: "",
      mode: "create",
      bytes: [...pdf],
    });
    assert.equal(imported.documentType, "pdf");
    assert.deepEqual(await fs.readFile(path.join(root, "Spec.pdf")), pdf);

    const spreadsheet = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
    const importedSpreadsheet = await invoke("doc_import_external", {
      root,
      name: "Forecast.xlsx",
      destFolder: "",
      mode: "create",
      bytes: [...spreadsheet],
    });
    assert.equal(importedSpreadsheet.documentType, "excel");
    assert.deepEqual(await fs.readFile(path.join(root, "Forecast.xlsx")), spreadsheet);

    const csv = Buffer.from("name,value\nalpha,1\n", "utf8");
    const importedCsv = await invoke("doc_import_external", {
      root,
      name: "Data.csv",
      destFolder: "",
      mode: "create",
      bytes: [...csv],
    });
    assert.equal(importedCsv.documentType, "excel");
    assert.deepEqual(await fs.readFile(path.join(root, "Data.csv")), csv);

    await assert.rejects(
      invoke("doc_import_external", {
        root,
        name: "Spec.pdf",
        mode: "create",
        bytes: [...pdf],
      }),
      /destination already exists/
    );
  });
});

test("an imported copy with a duplicate authored id returns its path identity", async () => {
  await withWorkspace(async (root) => {
    const duplicate = "---\nid: copied-id\n---\n\nBody\n";
    await fs.writeFile(path.join(root, "Original.md"), duplicate);
    const invoke = createNativeWorkspaceDispatcher();

    const imported = await invoke("doc_import_external", {
      root,
      name: "Copy.md",
      bytes: Buffer.from(duplicate),
      mode: "create",
    });
    const scan = await invoke("workspace_scan", { root });

    assert.equal(imported.idSource, "path");
    assert.match(imported.id, /^path:/);
    assert.equal(scan.documents.find((item) => item.path === "Copy.md").id, imported.id);
    assert.equal(scan.documents.find((item) => item.path === "Original.md").idSource, "path");
  });
});

test("native workspace rejects final import symlinks and never indexes symlinked Pages", async (t) => {
  if (process.platform === "win32") return t.skip("symbolic-link contract is exercised on Unix");
  await withWorkspace(async (root) => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "doxmind-native-outside-"));
    try {
      const invoke = createNativeWorkspaceDispatcher();
      await fs.writeFile(path.join(root, "Visible.md"), "visible");
      await fs.writeFile(path.join(root, ".Visible.doxmind.bak.md"), "secret backup");
      await fs.writeFile(path.join(root, ".Visible.doxmind.lock.markdown"), "secret lock");
      const externalPage = path.join(outside, "Outside.md");
      await fs.writeFile(externalPage, "secret outside");
      await fs.symlink(externalPage, path.join(root, "Linked.md"));

      const scan = await invoke("workspace_scan", { root });
      assert.deepEqual(
        scan.documents.map((document) => document.path),
        ["Visible.md"]
      );
      assert.deepEqual(await invoke("workspace_markdown_search", { root, query: "secret" }), []);

      for (const [name, targetExists, mode] of [
        ["Create.md", false, "create"],
        ["Replace.md", true, "replace"],
      ]) {
        const target = path.join(outside, name);
        if (targetExists) await fs.writeFile(target, "outside original");
        const destination = path.join(root, name);
        await fs.symlink(target, destination);
        await assert.rejects(
          invoke("doc_import_external", {
            root,
            name,
            mode,
            bytes: [...Buffer.from("incoming")],
          }),
          /symbolic-link/
        );
        assert.equal((await fs.lstat(destination)).isSymbolicLink(), true);
        if (targetExists) assert.equal(await fs.readFile(target, "utf8"), "outside original");
        else await assert.rejects(fs.stat(target), { code: "ENOENT" });
      }
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });
});

test("Electron boot has no FastAPI lifecycle or workspace proxy", async () => {
  const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
  const mainSource = await fs.readFile(path.join(repoRoot, "electron", "main.js"), "utf8");
  const macEntitlements = await fs.readFile(
    path.join(repoRoot, "electron", "entitlements.mac.plist"),
    "utf8"
  );
  const packageJson = JSON.parse(await fs.readFile(path.join(repoRoot, "package.json"), "utf8"));
  const electronBuilder = await fs.readFile(path.join(repoRoot, "electron-builder.yml"), "utf8");
  const desktopWorkflows = await Promise.all(
    ["release.yml", "release-windows.yml"].map((name) =>
      fs.readFile(path.join(repoRoot, ".github", "workflows", name), "utf8")
    )
  );
  assert.doesNotMatch(mainSource, /spawnSidecar|waitForHealth|proxyWorkspace/);
  assert.doesNotMatch(
    macEntitlements,
    /disable-library-validation|allow-dyld-environment-variables/
  );
  assert.doesNotMatch(packageJson.scripts["dist:electron"], /sidecar/i);
  assert.equal(packageJson.scripts["release:electron"], undefined);
  assert.doesNotMatch(
    electronBuilder,
    /- ext: (?:\[pdf\]|pdf|\[xlsx, xlsm, csv\]|xlsx|xlsm|csv)[\s\S]{0,80}?role: Editor/
  );
  assert.match(electronBuilder, /- ext: \[pdf\][\s\S]{0,80}?role: Viewer/);
  assert.match(electronBuilder, /- ext: \[xlsx, xlsm, csv\][\s\S]{0,80}?role: Viewer/);
  for (const workflow of desktopWorkflows) {
    assert.doesNotMatch(workflow, /build:sidecar|PyInstaller|doxmind-server/i);
  }
  assert.equal(NATIVE_WORKSPACE_COMMANDS.has("doc_write_workspace"), true);
  assert.equal(NATIVE_WORKSPACE_COMMANDS.has("workspace_relocate_page"), true);
  assert.equal(NATIVE_WORKSPACE_COMMANDS.has("workspace_relocate_folder"), true);
  assert.equal(NATIVE_WORKSPACE_COMMANDS.has("workspace_rename_folder"), false);
  assert.equal(NATIVE_WORKSPACE_COMMANDS.has("doc_copy_source"), true);
  assert.equal(NATIVE_WORKSPACE_COMMANDS.has("workspace_inspect_attachment"), false);
  assert.equal(NATIVE_WORKSPACE_COMMANDS.has("workspace_read_attachment_recovery"), false);
  assert.equal(NATIVE_WORKSPACE_COMMANDS.has("workspace_inspect_page_recovery"), false);
  assert.equal(NATIVE_WORKSPACE_COMMANDS.has("workspace_read_page_recovery"), false);
});

test("keys nested inside a frontmatter mapping never become Page properties", async () => {
  await withWorkspace(async (root) => {
    const invoke = createNativeWorkspaceDispatcher();
    const source = "---\nid: page-5\nauthor:\n  name: Jane\n  status: done\n---\n\n# Body\n";
    await fs.writeFile(path.join(root, "Nested.md"), source);
    await fs.writeFile(
      path.join(root, "Nested id.md"),
      "---\nconfig:\n  id: nested-thing\n---\n\nBody\n"
    );

    const opened = await invoke("doc_read", { root, path: "Nested.md" });
    assert.equal(opened.meta.id, "page-5");
    assert.equal(opened.meta.author, "");
    assert.equal("name" in opened.meta, false);
    assert.equal("status" in opened.meta, false);

    const scan = await invoke("workspace_scan", { root });
    const nestedId = scan.documents.find((document) => document.path === "Nested id.md");
    assert.equal(nestedId.idSource, "path");
    assert.equal(nestedId.id.startsWith("path:"), true);

    await assert.rejects(
      invoke("doc_write_workspace", {
        root,
        path: "Nested.md",
        payload: { meta: { author: "Jane" }, expectedRevision: opened.revision },
      }),
      /cannot safely patch Page property 'author': nested YAML value/
    );
    assert.equal(await fs.readFile(path.join(root, "Nested.md"), "utf8"), source);
  });
});

test("a YAML document-end marker terminates frontmatter instead of swallowing prose", async () => {
  await withWorkspace(async (root) => {
    const invoke = createNativeWorkspaceDispatcher();
    const source = "---\nid: p\ntitle: T\n...\n\n# Body\n\n---\n\nAfter\n";
    await fs.writeFile(path.join(root, "Pandoc.md"), source);
    assert.deepEqual(splitPageSource(source).body, "# Body\n\n---\n\nAfter\n");

    const opened = await invoke("doc_read", { root, path: "Pandoc.md" });
    assert.equal(opened.markdown, "# Body\n\n---\n\nAfter\n");
    assert.equal(opened.meta.id, "p");
    assert.equal(opened.meta.title, "T");

    await invoke("doc_write_workspace", {
      root,
      path: "Pandoc.md",
      payload: {
        markdown: opened.markdown,
        meta: { favorite: true },
        expectedRevision: opened.revision,
      },
    });
    assert.equal(
      await fs.readFile(path.join(root, "Pandoc.md"), "utf8"),
      "---\nid: p\ntitle: T\nfavorite: true\n...\n\n# Body\n\n---\n\nAfter\n"
    );
  });
});

test("one undecodable Page keeps the rest of the workspace scannable", async () => {
  await withWorkspace(async (root) => {
    const invoke = createNativeWorkspaceDispatcher();
    await fs.writeFile(path.join(root, "Good.md"), "---\nid: good-1\n---\n\nBody\n");
    // "résumé" written by an old editor in Latin-1.
    await fs.writeFile(
      path.join(root, "Legacy.md"),
      Buffer.from([0x72, 0xe9, 0x73, 0x75, 0x6d, 0xe9, 0x0a])
    );

    const scan = await invoke("workspace_scan", { root });
    assert.deepEqual(
      scan.documents.map((document) => document.path),
      ["Good.md", "Legacy.md"]
    );
    const legacy = scan.documents.find((document) => document.path === "Legacy.md");
    assert.equal(legacy.idSource, "path");
    assert.equal(legacy.title, "Legacy");
    assert.equal((await invoke("doc_read", { root, path: "Good.md" })).markdown, "Body\n");

    // Byte fidelity still matters where the bytes are actually used.
    await assert.rejects(
      invoke("doc_read", { root, path: "Legacy.md" }),
      /Page is not valid UTF-8/
    );
  });
});

test("the scan carries frontmatter aliases, so a Wiki Link resolves without opening the Page", async () => {
  await withWorkspace(async (root) => {
    const invoke = createNativeWorkspaceDispatcher();
    await fs.writeFile(
      path.join(root, "Roadmap.md"),
      '---\naliases: ["Plan", "Q3 Plan"]\n---\n\n# Roadmap\n'
    );
    await fs.writeFile(path.join(root, "Plain.md"), "# Plain\n");

    const scan = await invoke("workspace_scan", { root });
    const roadmap = scan.documents.find((document) => document.path === "Roadmap.md");
    assert.deepEqual(roadmap.aliases, ["Plan", "Q3 Plan"]);
    // Absent rather than an empty array, so a Page without aliases stays the shape it was.
    assert.equal("aliases" in scan.documents.find((d) => d.path === "Plain.md"), false);
  });
});

test("search reports every hit, at line numbers the editor can actually reach", async () => {
  await withWorkspace(async (root) => {
    const invoke = createNativeWorkspaceDispatcher();
    // Line numbers used to be counted over the raw file, frontmatter included, so a hit in a Page
    // with frontmatter pointed several lines past where it really was.
    await fs.writeFile(
      path.join(root, "Framed.md"),
      "---\nid: framed\ntags: [needle]\n---\n\nAlpha\nneedle one\nBeta\nneedle two\n"
    );
    await fs.writeFile(path.join(root, "Plain.md"), "needle here\n");

    const results = await invoke("workspace_markdown_search", { root, query: "needle" });
    const framed = results.find((entry) => entry.path === "Framed.md");
    const plain = results.find((entry) => entry.path === "Plain.md");

    // Body lines 2 and 4 — not 7 and 9, and the `tags:` line is not content.
    assert.deepEqual(
      framed.matches.map((match) => [match.line, match.preview]),
      [
        [2, "needle one"],
        [4, "needle two"],
      ]
    );
    assert.equal(framed.matchCount, 2);
    assert.deepEqual(
      plain.matches.map((match) => match.line),
      [1]
    );
    assert.equal(plain.matchCount, 1);
  });
});


test("a failing snapshot never fails the Page save", async () => {
  await withWorkspace(async (root) => {
    const previousDataDir = process.env.DATA_DIR;
    // A path that cannot be a directory, so every snapshot write throws.
    process.env.DATA_DIR = path.join(root, "Note.md", "nope");
    try {
      const invoke = createNativeWorkspaceDispatcher();
      await fs.writeFile(path.join(root, "Note.md"), "first\n");
      const opened = await invoke("doc_read", { root, path: "Note.md" });

      const saved = await invoke("doc_write_workspace", {
        root,
        path: "Note.md",
        payload: { markdown: "second\n", expectedRevision: opened.revision },
      });

      assert.equal(saved.markdown, "second\n");
      assert.match(await fs.readFile(path.join(root, "Note.md"), "utf8"), /second/);
    } finally {
      if (previousDataDir === undefined) delete process.env.DATA_DIR;
      else process.env.DATA_DIR = previousDataDir;
    }
  });
});

test("search honours the query operators the renderer parsed", async () => {
  await withWorkspace(async (root) => {
    const invoke = createNativeWorkspaceDispatcher();
    await fs.mkdir(path.join(root, "Projects"), { recursive: true });
    await fs.writeFile(
      path.join(root, "Projects", "Alpha.md"),
      "---\ntags:\n  - project/web\n---\n\nneedle in alpha\n"
    );
    await fs.writeFile(
      path.join(root, "Beta.md"),
      "---\ntags:\n  - draft\n---\n\nneedle in beta\n"
    );
    await fs.writeFile(path.join(root, "Gamma.md"), "needle in gamma\n");

    const paths = async (criteria, query = "needle") =>
      (await invoke("workspace_markdown_search", { root, query, criteria }))
        .map((entry) => entry.path)
        .sort();

    const term = (field, value, extra = {}) => ({ field, value, negated: false, ...extra });

    assert.deepEqual(await paths({ groups: [[term("path", "projects")]] }), ["Projects/Alpha.md"]);
    assert.deepEqual(await paths({ groups: [[term("file", "beta")]] }), ["Beta.md"]);

    // Negation, and OR inside one group.
    assert.deepEqual(await paths({ groups: [[{ ...term("file", "beta"), negated: true }]] }), [
      "Gamma.md",
      "Projects/Alpha.md",
    ]);
    assert.deepEqual(await paths({ groups: [[term("file", "beta"), term("file", "gamma")]] }), [
      "Beta.md",
      "Gamma.md",
    ]);

    // Separate groups are ANDed.
    assert.deepEqual(
      await paths({ groups: [[term("path", "projects")], [term("file", "alpha")]] }),
      ["Projects/Alpha.md"]
    );

    // A constraint with no text still reports the Page, using its first body line.
    const constraintOnly = await invoke("workspace_markdown_search", {
      root,
      query: "",
      criteria: { groups: [[term("file", "beta")]] },
    });
    assert.deepEqual(
      constraintOnly.map((entry) => entry.path),
      ["Beta.md"]
    );
    assert.equal(constraintOnly[0].matches[0].preview, "needle in beta");
  });
});

test("search recompiles a regex term but refuses stateful flags", async () => {
  await withWorkspace(async (root) => {
    const invoke = createNativeWorkspaceDispatcher();
    await fs.writeFile(path.join(root, "A.md"), "needle one\n");
    await fs.writeFile(path.join(root, "B.md"), "NEEDLE two\n");

    const run = (criteria) => invoke("workspace_markdown_search", { root, query: "", criteria });

    const insensitive = await run({
      groups: [[{ field: "content", value: "/needle/i", negated: false, regexSource: "needle", regexFlags: "i" }]],
    });
    assert.deepEqual(insensitive.map((entry) => entry.path).sort(), ["A.md", "B.md"]);

    // `g` carries lastIndex between calls, so a shared RegExp would skip results at random.
    await assert.rejects(
      run({
        groups: [
          [{ field: "content", value: "/needle/g", negated: false, regexSource: "needle", regexFlags: "g" }],
        ],
      }),
      /search query is required/
    );
  });
});

test("search counts every hit in a Page but sends a bounded number of previews", async () => {
  await withWorkspace(async (root) => {
    const invoke = createNativeWorkspaceDispatcher();
    const lines = Array.from({ length: 120 }, (_, index) => `needle ${index}`);
    await fs.writeFile(path.join(root, "Many.md"), `${lines.join("\n")}\n`);

    const [result] = await invoke("workspace_markdown_search", { root, query: "needle" });
    assert.equal(result.matchCount, 120);
    assert.equal(result.matches.length, 50);
    // The previews that do come back are the first ones, in order.
    assert.equal(result.matches[0].line, 1);
    assert.equal(result.matches.at(-1).line, 50);
  });
});

test("the scan reports real folders and every other file, so nothing on disk is invisible", async () => {
  await withWorkspace(async (root) => {
    const invoke = createNativeWorkspaceDispatcher();
    await fs.mkdir(path.join(root, "assets"), { recursive: true });
    await fs.mkdir(path.join(root, "Empty"), { recursive: true });
    await fs.mkdir(path.join(root, ".github"), { recursive: true });
    await fs.mkdir(path.join(root, "node_modules"), { recursive: true });
    await fs.writeFile(path.join(root, "Note.md"), "# Note\n");
    // The directory our own image paste writes into, and the files an Obsidian vault brings.
    await fs.writeFile(path.join(root, "assets", "diagram.png"), "not really a png");
    await fs.writeFile(path.join(root, "Board.canvas"), "{}");
    await fs.writeFile(path.join(root, "Tasks.base"), "{}");
    await fs.writeFile(path.join(root, ".github", "README.md"), "# CI\n");
    await fs.writeFile(path.join(root, "node_modules", "pkg.md"), "# Vendored\n");

    const scan = await invoke("workspace_scan", { root });
    const folders = scan.folders.map((folder) => folder.path);
    const assets = scan.assets.map((asset) => asset.path);

    // An empty folder survives, because folders are no longer inferred from the files inside them.
    assert.deepEqual(folders, ["assets", "Empty"]);
    assert.deepEqual(assets, ["assets/diagram.png", "Board.canvas", "Tasks.base"]);
    assert.equal(
      scan.documents.some((document) => document.path === "node_modules/pkg.md"),
      false
    );
    // Descent still follows a dot directory, but neither it nor its contents becomes a row.
    assert.equal(
      scan.documents.some((document) => document.path === ".github/README.md"),
      true
    );
    assert.equal(folders.includes(".github"), false);

    // The asset keeps its extension: a file tree has to show `diagram.png`, not `diagram`.
    assert.equal(scan.assets.find((asset) => asset.path === "assets/diagram.png").name, "diagram.png");
  });
});

test("the scan skips the folders the user excluded, by name only", async () => {
  await withWorkspace(async (root) => {
    const invoke = createNativeWorkspaceDispatcher();
    await fs.mkdir(path.join(root, "Archive"), { recursive: true });
    await fs.writeFile(path.join(root, "Archive", "Old.md"), "# Old\n");
    await fs.writeFile(path.join(root, "Keep.md"), "# Keep\n");

    const excluded = await invoke("workspace_scan", { root, excludeDirs: ["Archive", "", "../x"] });
    assert.deepEqual(
      excluded.documents.map((document) => document.path),
      ["Keep.md"]
    );
    assert.deepEqual(excluded.folders, []);

    // A path-shaped or empty entry is discarded rather than matched, so it excludes nothing.
    const unfiltered = await invoke("workspace_scan", { root, excludeDirs: ["Archive/Old.md"] });
    assert.equal(unfiltered.documents.length, 2);
  });
});

test("a vault written by Obsidian carries its tags and aliases into the scan", async () => {
  await withWorkspace(async (root) => {
    const invoke = createNativeWorkspaceDispatcher();
    // The block sequence is Obsidian's own default shape for both keys. Reading only the key's
    // line saw an empty scalar, so an imported vault arrived with no tags and no aliases at all.
    await fs.writeFile(
      path.join(root, "Roadmap.md"),
      "---\ntags:\n  - project\n  - urgent\naliases:\n  - Plan\n  - Q3 Plan\n---\n\n# Roadmap\n"
    );
    // Zero indentation is equally valid YAML, and Obsidian writes it too.
    await fs.writeFile(path.join(root, "Flat.md"), "---\ntags:\n- inbox\n---\n\n# Flat\n");
    // An unquoted flow sequence is not JSON, and used to survive as a literal string.
    await fs.writeFile(path.join(root, "Flow.md"), "---\ntags: [alpha, beta]\n---\n\n# Flow\n");

    // Aliases reach the scan, because a Wiki Link resolves against them without opening the Page.
    const scan = await invoke("workspace_scan", { root });
    const roadmap = scan.documents.find((document) => document.path === "Roadmap.md");
    assert.deepEqual(roadmap.aliases, ["Plan", "Q3 Plan"]);

    // Tags reach the properties panel through the Page itself.
    const opened = await invoke("doc_read", { root, path: "Roadmap.md" });
    assert.deepEqual(opened.meta.tags, ["project", "urgent"]);
    assert.deepEqual(opened.meta.aliases, ["Plan", "Q3 Plan"]);
    assert.deepEqual((await invoke("doc_read", { root, path: "Flat.md" })).meta.tags, ["inbox"]);
    assert.deepEqual((await invoke("doc_read", { root, path: "Flow.md" })).meta.tags, [
      "alpha",
      "beta",
    ]);

    // Editing one list leaves the other, and the body, byte-identical.
    await invoke("doc_write_workspace", {
      root,
      path: "Roadmap.md",
      payload: { meta: { tags: ["project", "shipped"] }, expectedRevision: opened.revision },
    });
    assert.equal(
      await fs.readFile(path.join(root, "Roadmap.md"), "utf8"),
      "---\ntags:\n  - project\n  - shipped\naliases:\n  - Plan\n  - Q3 Plan\n---\n\n# Roadmap\n"
    );
  });
});

test("a Page save preserves the file's permissions through the process umask", async (t) => {
  if (process.platform === "win32") {
    t.skip("POSIX permission bits");
    return;
  }
  await withWorkspace(async (root) => {
    const invoke = createNativeWorkspaceDispatcher();
    const pagePath = path.join(root, "Shared.md");
    await fs.writeFile(pagePath, "---\nid: shared-1\n---\n\nBody\n");
    await fs.chmod(pagePath, 0o664);
    const opened = await invoke("doc_read", { root, path: "Shared.md" });

    const previousUmask = process.umask(0o022);
    try {
      await invoke("doc_write_workspace", {
        root,
        path: "Shared.md",
        payload: { markdown: "Changed\n", expectedRevision: opened.revision },
      });
    } finally {
      process.umask(previousUmask);
    }

    assert.equal((await fs.stat(pagePath)).mode & 0o777, 0o664);
  });
});

test("a case-only Page rename is a relocation, not a destination collision", async () => {
  await withWorkspace(async (root) => {
    const invoke = createNativeWorkspaceDispatcher();
    await fs.writeFile(path.join(root, "readme.md"), "---\nid: readme-1\n---\n\nBody\n");
    const recoveryBytes = Buffer.from([7, 8, 9]);
    await fs.writeFile(path.join(root, ".readme.doxmind"), recoveryBytes);
    const opened = await invoke("doc_read", { root, path: "readme.md" });

    const relocated = await invoke("workspace_relocate_page", {
      root,
      oldPath: "readme.md",
      newPath: "README.md",
      expectedRevision: opened.revision,
      checks: [{ path: "readme.md", expectedRevision: opened.revision }],
      writes: [],
    });

    assert.equal(relocated.document.path, "README.md");
    assert.equal(
      await fs.readFile(path.join(root, "README.md"), "utf8"),
      "---\nid: readme-1\n---\n\nBody\n"
    );
    assert.deepEqual(await fs.readFile(path.join(root, ".README.doxmind")), recoveryBytes);

    // A genuinely occupied destination is still refused.
    await fs.writeFile(path.join(root, "Other.md"), "---\nid: other-1\n---\n\nOther\n");
    const moved = await invoke("doc_read", { root, path: "README.md" });
    const other = await invoke("doc_read", { root, path: "Other.md" });
    await assert.rejects(
      invoke("workspace_relocate_page", {
        root,
        oldPath: "README.md",
        newPath: "Other.md",
        expectedRevision: moved.revision,
        checks: [
          { path: "README.md", expectedRevision: moved.revision },
          { path: "Other.md", expectedRevision: other.revision },
        ],
        writes: [],
      }),
      /destination already exists: Other.md/
    );
    assert.equal(
      await fs.readFile(path.join(root, "Other.md"), "utf8"),
      "---\nid: other-1\n---\n\nOther\n"
    );
  });
});

test("Page creation overwrites only when the caller carries the user's consent", async () => {
  await withWorkspace(async (root) => {
    const invoke = createNativeWorkspaceDispatcher();
    const existing = "---\nid: draft-1\ntitle: Old\n---\n\nOld body\n";
    await fs.writeFile(path.join(root, "Draft.md"), existing);

    // Default: an occupied destination is never silently overwritten.
    await assert.rejects(
      invoke("doc_create", {
        root,
        payload: { path: "Draft.md", markdown: "New body", meta: { id: "draft-2" } },
      }),
      /document already exists: Draft.md/
    );
    assert.equal(await fs.readFile(path.join(root, "Draft.md"), "utf8"), existing);

    // The native Save panel already asked "replace?"; carry that through.
    const created = await invoke("doc_create", {
      root,
      payload: {
        path: "Draft.md",
        markdown: "New body",
        meta: { id: "draft-2" },
        replaceExisting: true,
      },
    });
    assert.equal(created.path, "Draft.md");
    assert.equal(created.id, "draft-2");
    assert.equal(
      await fs.readFile(path.join(root, "Draft.md"), "utf8"),
      "---\nid: draft-2\n---\n\nNew body"
    );

    // Consent replaces a file, never a directory.
    await fs.mkdir(path.join(root, "Folder.md"));
    await assert.rejects(
      invoke("doc_create", {
        root,
        payload: { path: "Folder.md", markdown: "x", replaceExisting: true },
      }),
      /document already exists: Folder.md/
    );
  });
});

test("a case-only folder rename is a relocation, not a destination collision", async () => {
  await withWorkspace(async (root) => {
    const invoke = createNativeWorkspaceDispatcher();
    await fs.mkdir(path.join(root, "notes"));
    await fs.writeFile(path.join(root, "notes", "Plan.md"), "---\nid: plan-1\n---\n\n[[Spec]]\n");
    await fs.writeFile(path.join(root, "notes", "Spec.md"), "---\nid: spec-1\n---\n\nSpec\n");
    const plan = await invoke("doc_read", { root, path: "notes/Plan.md" });
    const spec = await invoke("doc_read", { root, path: "notes/Spec.md" });

    const relocated = await invoke("workspace_relocate_folder", {
      root,
      oldPath: "notes",
      newPath: "Notes",
      checks: [
        { path: "notes/Plan.md", expectedRevision: plan.revision },
        { path: "notes/Spec.md", expectedRevision: spec.revision },
      ],
      writes: [],
    });

    assert.equal(relocated.path, "Notes");
    assert.deepEqual(relocated.writes, []);
    const scan = await invoke("workspace_scan", { root });
    assert.deepEqual(scan.documents.map((document) => document.path).sort(), [
      "Notes/Plan.md",
      "Notes/Spec.md",
    ]);
    // A case-only rename resolves the same Pages, so no link may be rewritten.
    assert.equal(
      await fs.readFile(path.join(root, "Notes", "Plan.md"), "utf8"),
      "---\nid: plan-1\n---\n\n[[Spec]]\n"
    );

    // A genuinely occupied destination is still refused.
    await fs.mkdir(path.join(root, "Archive"));
    const moved = await invoke("doc_read", { root, path: "Notes/Plan.md" });
    const movedSpec = await invoke("doc_read", { root, path: "Notes/Spec.md" });
    await assert.rejects(
      invoke("workspace_relocate_folder", {
        root,
        oldPath: "Notes",
        newPath: "Archive",
        checks: [
          { path: "Notes/Plan.md", expectedRevision: moved.revision },
          { path: "Notes/Spec.md", expectedRevision: movedSpec.revision },
        ],
        writes: [],
      }),
      /destination already exists: Archive/
    );
    assert.equal((await fs.stat(path.join(root, "Notes"))).isDirectory(), true);
  });
});

test("a case-only Attachment rename is a relocation, not a destination collision", async () => {
  await withWorkspace(async (root) => {
    const invoke = createNativeWorkspaceDispatcher();
    await fs.writeFile(path.join(root, "spec.pdf"), Buffer.from("%PDF-1.4\n"));

    const renamed = await invoke("doc_rename", {
      root,
      oldPath: "spec.pdf",
      newPath: "Spec.pdf",
    });

    assert.equal(renamed.path, "Spec.pdf");
    const scan = await invoke("workspace_scan", { root });
    assert.deepEqual(
      scan.documents.map((document) => document.path),
      ["Spec.pdf"]
    );
  });
});


test("a constraint-only search reports the Page, not every line in it", async () => {
  await withWorkspace(async (root) => {
    const invoke = createNativeWorkspaceDispatcher();
    await fs.writeFile(
      path.join(root, "Tagged.md"),
      "---\ntags:\n  - project\n---\n\nAlpha line.\nBeta line.\nGamma line.\n",
      "utf8"
    );

    const constraintOnly = await invoke("workspace_markdown_search", {
      root,
      query: "",
      criteria: { groups: [[{ field: "file", value: "tagged" }]] },
    });
    assert.equal(constraintOnly.length, 1);
    // `file:tagged` has no text to point at, so the Page is the hit: one preview, its first
    // real line. Matching every line was `includes("")` being true for all of them.
    assert.equal(constraintOnly[0].matchCount, 1);
    assert.deepEqual(
      constraintOnly[0].matches.map((match) => match.preview),
      ["Alpha line."]
    );

    // A text term alongside the constraint still matches only that text.
    const withText = await invoke("workspace_markdown_search", {
      root,
      query: "beta",
      criteria: { groups: [[{ field: "file", value: "tagged" }]] },
    });
    assert.deepEqual(
      withText[0].matches.map((match) => match.preview),
      ["Beta line."]
    );
  });
});

test("rewriting a tag list keeps entries that YAML would read back as another type", async () => {
  await withWorkspace(async (root) => {
    const invoke = createNativeWorkspaceDispatcher();
    const rel = "Note.md";
    await fs.writeFile(
      path.join(root, rel),
      '---\ntags:\n  - "1984"\n  - "true"\n  - plain\n  - work/active\n---\n\nBody.\n',
      "utf8"
    );

    const before = await invoke("doc_read", { root, path: rel });
    assert.deepEqual(before.meta.tags, ["1984", "true", "plain", "work/active"]);

    // Adding a tag rewrites the whole sequence. Emitting "1984" bare would make YAML read it
    // back as the number 1984, and "true" as a boolean — the user's tag changing type.
    await invoke("doc_write_workspace", {
      root,
      path: rel,
      payload: {
        meta: { tags: ["1984", "true", "plain", "work/active", "added"] },
        expectedRevision: before.revision,
      },
    });

    const after = await invoke("doc_read", { root, path: rel });
    assert.deepEqual(after.meta.tags, ["1984", "true", "plain", "work/active", "added"]);
    // Obsidian-style bare tags stay bare, so a round-trip still looks hand-written.
    const source = await fs.readFile(path.join(root, rel), "utf8");
    assert.match(source, /^ {2}- plain$/m);
    assert.match(source, /^ {2}- work\/active$/m);
    assert.match(source, /^ {2}- "1984"$/m);
    assert.match(source, /^ {2}- "true"$/m);
  });
});
