import * as React from "react";
import { render, screen } from "@testing-library/react";
import { useTranslations } from "next-intl";
import { beforeEach, describe, expect, it } from "vitest";

import { ClientIntlProvider } from "@/i18n/intl-provider";
import { useLayoutStore } from "@/stores/layout-store";
import en from "@/messages/en.json";
import zh from "@/messages/zh.json";

function Probe() {
  const t = useTranslations("settings");
  return <span data-testid="probe">{t("language")}</span>;
}

const flatten = (value: unknown, prefix = ""): string[] =>
  typeof value === "object" && value !== null
    ? Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
        flatten(child, `${prefix}${key}.`)
      )
    : [prefix.slice(0, -1)];

const read = (source: unknown, key: string) =>
  key.split(".").reduce<unknown>((acc, part) => (acc as Record<string, unknown>)?.[part], source);

describe("UI language", () => {
  beforeEach(() => {
    document.cookie = "NEXT_LOCALE=; path=/; max-age=0";
    useLayoutStore.setState({ locale: "en" });
  });

  it("renders the chosen language without a reload", () => {
    useLayoutStore.setState({ locale: "zh" });
    render(
      <ClientIntlProvider>
        <Probe />
      </ClientIntlProvider>
    );
    expect(screen.getByTestId("probe").textContent).toBe(zh.settings.language);
  });

  it("writes the cookie the cold-start path reads, so a restart keeps the choice", () => {
    useLayoutStore.getState().setLocale("zh");
    expect(document.cookie).toContain("NEXT_LOCALE=zh");
    expect(useLayoutStore.getState().locale).toBe("zh");
  });

  // Values that are the same in both catalogs on purpose: each is an identifier the user types
  // literally, not prose. Anything else identical in both means a string was added to one only.
  const IDENTICAL_ON_PURPOSE = new Set([
    "pageProperties.propertyNamePlaceholder", // a YAML key, e.g. `status`
    "settings.workspaceExcludesPlaceholder", // an example folder name
  ]);

  it("ships a Chinese string for every English one", () => {
    expect(flatten(zh)).toEqual(flatten(en));

    const untranslated = flatten(en).filter((key) => {
      if (IDENTICAL_ON_PURPOSE.has(key)) return false;
      const enValue = read(en, key);
      if (typeof enValue !== "string" || enValue !== read(zh, key)) return false;
      // Ignore the interpolation placeholders themselves — `{name}` is not English.
      return /[A-Za-z]{4,}/.test(enValue.replace(/\{[^}]*\}/g, ""));
    });

    expect(untranslated).toEqual([]);
  });
});
