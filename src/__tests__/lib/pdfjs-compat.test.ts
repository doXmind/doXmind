import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: {},
}));

import { installPdfjsCompatibilityPolyfills } from "@/lib/pdf/pdfjs";

const originalReadableStream = globalThis.ReadableStream;

afterEach(() => {
  Object.defineProperty(globalThis, "ReadableStream", {
    configurable: true,
    writable: true,
    value: originalReadableStream,
  });
});

describe("PDF.js compatibility polyfills", () => {
  it("adds async iteration to ReadableStream implementations that only expose getReader", async () => {
    const cancel = vi.fn(() => Promise.resolve());
    const releaseLock = vi.fn();

    class LegacyReadableStream {
      private readonly chunks: Uint8Array[];

      constructor(chunks: Uint8Array[]) {
        this.chunks = chunks;
      }

      getReader() {
        let index = 0;
        return {
          read: () => {
            const value = this.chunks[index++];
            return Promise.resolve(
              value ? { value, done: false } : { value: undefined, done: true }
            );
          },
          cancel,
          releaseLock,
        };
      }
    }

    Object.defineProperty(globalThis, "ReadableStream", {
      configurable: true,
      writable: true,
      value: LegacyReadableStream,
    });

    installPdfjsCompatibilityPolyfills();

    const stream = new LegacyReadableStream([new Uint8Array([1]), new Uint8Array([2])]);
    const values: number[] = [];
    for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) {
      values.push(chunk[0]);
    }

    expect(values).toEqual([1, 2]);
    const patchedPrototype =
      LegacyReadableStream.prototype as typeof LegacyReadableStream.prototype & {
        values: () => AsyncIterator<Uint8Array>;
        [Symbol.asyncIterator]: () => AsyncIterator<Uint8Array>;
      };
    expect(patchedPrototype.values).toBeTypeOf("function");
    expect(patchedPrototype[Symbol.asyncIterator]).toBe(patchedPrototype.values);
    expect(cancel).not.toHaveBeenCalled();
    expect(releaseLock).not.toHaveBeenCalled();
  });
});
