import { NextIntlClientProvider } from "next-intl";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ImportConflictModal } from "@/components/sidebar/import-conflict-modal";
import type { CollisionItem } from "@/lib/external-import-resolver";
import en from "@/messages/en.json";

function renderModal(collisions: CollisionItem[]) {
  render(
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <ImportConflictModal open collisions={collisions} onApply={vi.fn()} onCancelAll={vi.fn()} />
    </NextIntlClientProvider>
  );
}

describe("ImportConflictModal attachment boundary", () => {
  it.each([
    ["Spec.pdf", ".pdf"],
    ["Forecast.xlsx", ".xlsx"],
    ["Data.csv", ".csv"],
  ] as const)("does not offer Replace for attachment collision %s", async (name, extension) => {
    renderModal([{ item: { name }, extension, existingName: name }]);

    const choices = within(await screen.findByRole("radiogroup", { name }));
    expect(choices.queryByRole("radio", { name: "Replace" })).not.toBeInTheDocument();
    expect(choices.getByRole("radio", { name: "Keep both" })).toBeInTheDocument();
    expect(choices.getByRole("radio", { name: "Skip" })).toBeInTheDocument();
  });

  it("still offers Replace for a Markdown Page collision", async () => {
    const name = "Plan.md";
    renderModal([{ item: { name }, extension: ".md", existingName: name }]);

    const choices = within(await screen.findByRole("radiogroup", { name }));
    expect(choices.getByRole("radio", { name: "Replace" })).toBeInTheDocument();
  });
});
