"use client";

import { useState, useEffect, useCallback } from "react";

// Network Information API types (not in standard TypeScript)
interface NetworkInformation extends EventTarget {
  effectiveType?: string;
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
}

interface NavigatorWithConnection extends Navigator {
  connection?: NetworkInformation;
}

interface NetworkStatus {
  isOnline: boolean;
  wasOffline: boolean;
  connectionType?: string;
}

/**
 * Hook to monitor network connectivity status
 * Provides real-time updates when connection status changes
 */
export function useNetworkStatus(): NetworkStatus {
  const [status, setStatus] = useState<NetworkStatus>({
    isOnline: true,
    wasOffline: false,
    connectionType: undefined,
  });

  const updateOnlineStatus = useCallback(() => {
    const online = navigator.onLine;

    setStatus((prev) => ({
      isOnline: online,
      wasOffline: prev.wasOffline || (!online && prev.isOnline),
      connectionType: getConnectionType(),
    }));
  }, []);

  useEffect(() => {
    // Initialize status
    setStatus({
      isOnline: navigator.onLine,
      wasOffline: false,
      connectionType: getConnectionType(),
    });

    // Add event listeners
    window.addEventListener("online", updateOnlineStatus);
    window.addEventListener("offline", updateOnlineStatus);

    // Listen for connection changes (if available)
    const connection = (navigator as NavigatorWithConnection).connection;
    if (connection) {
      connection.addEventListener("change", updateOnlineStatus);
    }

    return () => {
      window.removeEventListener("online", updateOnlineStatus);
      window.removeEventListener("offline", updateOnlineStatus);
      if (connection) {
        connection.removeEventListener("change", updateOnlineStatus);
      }
    };
  }, [updateOnlineStatus]);

  return status;
}

/**
 * Get connection type from Network Information API (if available)
 */
function getConnectionType(): string | undefined {
  const connection = (navigator as NavigatorWithConnection).connection;
  if (connection?.effectiveType) {
    return connection.effectiveType;
  }
  return undefined;
}
