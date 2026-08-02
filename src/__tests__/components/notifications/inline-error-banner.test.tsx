import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InlineErrorBanner } from "@/components/notifications/inline-error-banner";
import { useNotificationStore } from "@/stores/notification-store";

// Banner removal is driven by framer-motion's exit animation, which doesn't
// progress under fake timers — so DOM-level assertions about "is it gone"
// would be flaky. We assert on the underlying store state instead: the
// auto-dismiss timer's only job is to call `dismissError`, which removes the
// entry from `errors`. That's the contract we care about.

describe("InlineErrorBanner", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useNotificationStore.getState().clearAllErrors();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    useNotificationStore.getState().clearAllErrors();
  });

  it("auto-dismisses transient errors after 5s", () => {
    render(<InlineErrorBanner />);

    act(() => {
      useNotificationStore.getState().pushError("Transient failure");
    });

    expect(useNotificationStore.getState().errors).toHaveLength(1);
    expect(screen.getByText("Transient failure")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(useNotificationStore.getState().errors).toHaveLength(0);
  });

  it("keeps persistent errors visible past the 5s dismiss window", () => {
    render(<InlineErrorBanner />);

    act(() => {
      useNotificationStore.getState().pushError("Document opened in read-only mode", {
        description: "Legacy recovery data is read-only.",
        persistent: true,
      });
    });

    expect(screen.getByText("Document opened in read-only mode")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(10_000);
    });

    expect(useNotificationStore.getState().errors).toHaveLength(1);
    expect(screen.getByText("Document opened in read-only mode")).toBeInTheDocument();
  });

  it("lets the user manually dismiss a persistent banner", () => {
    render(<InlineErrorBanner />);

    act(() => {
      useNotificationStore.getState().pushError("Document opened in read-only mode", {
        persistent: true,
      });
    });

    expect(useNotificationStore.getState().errors).toHaveLength(1);

    const dismissButton = screen.getByLabelText("Dismiss notification");
    act(() => {
      dismissButton.click();
    });

    expect(useNotificationStore.getState().errors).toHaveLength(0);
  });

  // The banner used to sit at top-3, i.e. y=12..56 — squarely on the 32px tab
  // strip (y=17..49). A rename conflict covered four tabs and blocked clicks on
  // three of them for the full five seconds. The chrome band ends at y=80
  // (44px header + the 36px Page-controls row), so the banner starts below it.
  it("is anchored clear of the tab strip and the Page-controls band", () => {
    render(<InlineErrorBanner />);

    const region = screen.getByRole("region", { name: "Notifications" });
    expect(region.className.split(/\s+/)).toContain("top-[88px]");
    expect(region.className.split(/\s+/)).not.toContain("top-3");
  });

  it("takes pointer events on the dismiss control only", () => {
    render(<InlineErrorBanner />);

    act(() => {
      useNotificationStore.getState().pushError("Failed to rename file");
    });

    const card = screen.getByRole("alert");
    expect(card.className.split(/\s+/)).toContain("pointer-events-none");
    expect(screen.getByLabelText("Dismiss notification").className.split(/\s+/)).toContain(
      "pointer-events-auto"
    );
  });
});
