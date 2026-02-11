/**
 * Tests for Link Paste URL regex
 */
import { describe, it, expect } from "vitest";

// Extract the URL regex from the link-paste extension for testing
const URL_REGEX = /^https?:\/\/[^\s<>]+$/i;

describe("Link Paste - URL Regex", () => {
  describe("valid URLs", () => {
    it("matches simple http URL", () => {
      expect(URL_REGEX.test("http://example.com")).toBe(true);
    });

    it("matches simple https URL", () => {
      expect(URL_REGEX.test("https://example.com")).toBe(true);
    });

    it("matches URL with path", () => {
      expect(URL_REGEX.test("https://example.com/path/to/page")).toBe(true);
    });

    it("matches URL with query parameters", () => {
      expect(URL_REGEX.test("https://example.com/search?q=hello&lang=en")).toBe(true);
    });

    it("matches URL with hash fragment", () => {
      expect(URL_REGEX.test("https://example.com/page#section")).toBe(true);
    });

    it("matches URL with port", () => {
      expect(URL_REGEX.test("https://localhost:3000/api")).toBe(true);
    });

    it("matches URL with subdomain", () => {
      expect(URL_REGEX.test("https://docs.google.com/document")).toBe(true);
    });

    it("is case insensitive for protocol", () => {
      expect(URL_REGEX.test("HTTPS://EXAMPLE.COM")).toBe(true);
      expect(URL_REGEX.test("Http://Example.com")).toBe(true);
    });

    it("matches URL with special characters in path", () => {
      expect(URL_REGEX.test("https://example.com/path/with-dashes_underscores")).toBe(true);
    });

    it("matches URL with encoded characters", () => {
      expect(URL_REGEX.test("https://example.com/path%20with%20spaces")).toBe(true);
    });
  });

  describe("invalid URLs", () => {
    it("rejects plain text", () => {
      expect(URL_REGEX.test("hello world")).toBe(false);
    });

    it("rejects empty string", () => {
      expect(URL_REGEX.test("")).toBe(false);
    });

    it("rejects URL without protocol", () => {
      expect(URL_REGEX.test("example.com")).toBe(false);
    });

    it("rejects ftp protocol", () => {
      expect(URL_REGEX.test("ftp://example.com")).toBe(false);
    });

    it("rejects URL with spaces", () => {
      expect(URL_REGEX.test("https://example.com/path with spaces")).toBe(false);
    });

    it("rejects URL with angle brackets", () => {
      expect(URL_REGEX.test("https://example.com/<script>")).toBe(false);
    });

    it("rejects just protocol", () => {
      expect(URL_REGEX.test("https://")).toBe(false);
    });

    it("rejects multiple URLs", () => {
      expect(URL_REGEX.test("https://a.com https://b.com")).toBe(false);
    });

    it("rejects URL with leading text", () => {
      expect(URL_REGEX.test("visit https://example.com")).toBe(false);
    });

    it("rejects URL with trailing text", () => {
      expect(URL_REGEX.test("https://example.com is great")).toBe(false);
    });
  });
});
