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
        description: "DOXMIND_SIDECAR_MIGRATE=off is in effect against a legacy sidecar.",
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
});
