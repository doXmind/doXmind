import { afterEach, describe, expect, it } from "vitest";

import { getApiBase } from "@/lib/api/base";

const originalApiUrl = process.env.NEXT_PUBLIC_API_URL;

afterEach(() => {
  if (originalApiUrl === undefined) delete process.env.NEXT_PUBLIC_API_URL;
  else process.env.NEXT_PUBLIC_API_URL = originalApiUrl;
});

describe("standalone tooling API locality", () => {
  it.each(["http://localhost:9000/", "http://127.0.0.1:9000", "http://[::1]:9000/"])(
    "accepts loopback API base %s",
    (base) => {
      process.env.NEXT_PUBLIC_API_URL = base;
      expect(getApiBase()).toBe(base.replace(/\/+$/, ""));
    }
  );

  it.each([
    "https://example.com/api",
    "http://localhost.example.com:9000",
    "http://127.0.0.1@example.com",
    "ftp://127.0.0.1:9000",
    "not a URL",
  ])("never uses non-loopback API base %s", (base) => {
    process.env.NEXT_PUBLIC_API_URL = base;
    expect(getApiBase()).toBe("http://127.0.0.1:8000");
  });
});
