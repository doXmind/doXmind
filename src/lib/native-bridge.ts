/**
 * Native Bridge for React Native WebView
 *
 * Provides communication between the web app and React Native
 * when running inside a WebView container.
 */

// Extend Window interface for TypeScript
declare global {
  interface Window {
    ReactNativeWebView?: {
      postMessage: (message: string) => void;
    };
  }
}

/**
 * Check if running inside a React Native WebView
 * Uses a getter to check dynamically since ReactNativeWebView may be injected after initial load
 */
export function getIsNativeWebView(): boolean {
  if (typeof window === "undefined") return false;
  // Check for ReactNativeWebView (injected by react-native-webview)
  if (window.ReactNativeWebView) return true;
  // Also check for custom flag that we inject early
  if ((window as unknown as { isNativeWebView?: boolean }).isNativeWebView) return true;
  return false;
}

// For backwards compatibility, also export as a constant that checks once
// But prefer using getIsNativeWebView() for dynamic checks
export const isNativeWebView = getIsNativeWebView();

/**
 * Send a message to React Native
 */
export function postToNative(type: string, payload: unknown = {}): void {
  if (isNativeWebView && window.ReactNativeWebView) {
    window.ReactNativeWebView.postMessage(JSON.stringify({ type, payload }));
  }
}

/**
 * Native Bridge API
 * Provides native functionality when running in RN WebView
 */
export const nativeBridge = {
  /**
   * Haptic feedback - uses expo-haptics on native
   */
  haptic: {
    light: () => postToNative("HAPTIC", { style: "light" }),
    medium: () => postToNative("HAPTIC", { style: "medium" }),
    heavy: () => postToNative("HAPTIC", { style: "heavy" }),
    success: () => postToNative("HAPTIC", { style: "success" }),
    error: () => postToNative("HAPTIC", { style: "error" }),
    tick: () => postToNative("HAPTIC", { style: "light" }),
    selection: () => postToNative("HAPTIC", { style: "selection" }),
    impact: () => postToNative("HAPTIC", { style: "medium" }),
  },

  /**
   * Voice recording - uses expo-av on native
   */
  voice: {
    start: () => {
      postToNative("VOICE_START", {});
      return Promise.resolve();
    },
    stop: () => {
      postToNative("VOICE_STOP", {});
      return Promise.resolve();
    },
    cancel: () => {
      postToNative("VOICE_CANCEL", {});
    },
  },

  /**
   * Image picker - uses expo-image-picker on native
   */
  imagePicker: {
    pick: () => {
      postToNative("IMAGE_PICK", {});
    },
    camera: () => {
      postToNative("IMAGE_CAMERA", {});
    },
  },

  /**
   * Auth - notify RN about auth state changes
   */
  auth: {
    onLogin: (token: string, user: unknown) => {
      postToNative("AUTH_LOGIN", { token, user });
    },
    onLogout: () => {
      postToNative("AUTH_LOGOUT", {});
    },
    requestToken: () => {
      postToNative("AUTH_REQUEST_TOKEN", {});
    },
  },

  /**
   * Navigation - request RN navigation actions
   */
  navigation: {
    back: () => postToNative("NAV_BACK", {}),
    openSettings: () => postToNative("NAV_SETTINGS", {}),
  },

  /**
   * Keyboard - notify RN about keyboard state
   */
  keyboard: {
    willShow: (height: number) => postToNative("KEYBOARD_WILL_SHOW", { height }),
    willHide: () => postToNative("KEYBOARD_WILL_HIDE", {}),
  },

  /**
   * Status - notify RN about app state
   */
  status: {
    ready: () => postToNative("APP_READY", {}),
    error: (message: string) => postToNative("APP_ERROR", { message }),
  },
};

/**
 * Listen for messages from React Native
 */
export function onNativeMessage(handler: (type: string, payload: unknown) => void): () => void {
  const listener = (event: MessageEvent) => {
    try {
      const data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
      if (data.type) {
        handler(data.type, data.payload || {});
      }
    } catch {
      // Ignore non-JSON messages
    }
  };

  window.addEventListener("message", listener);
  document.addEventListener("message", listener as EventListener);

  return () => {
    window.removeEventListener("message", listener);
    document.removeEventListener("message", listener as EventListener);
  };
}

/**
 * Request a value from React Native and wait for response
 */
export function requestFromNative<T>(
  type: string,
  payload: unknown = {},
  timeout = 5000
): Promise<T> {
  return new Promise((resolve, reject) => {
    const requestId = `${type}_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    const cleanup = onNativeMessage((msgType, msgPayload) => {
      const response = msgPayload as { requestId?: string; data?: T; error?: string };
      if (msgType === `${type}_RESPONSE` && response.requestId === requestId) {
        cleanup();
        clearTimeout(timer);
        if (response.error) {
          reject(new Error(response.error));
        } else {
          resolve(response.data as T);
        }
      }
    });

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Native request timeout: ${type}`));
    }, timeout);

    postToNative(type, { ...(payload as object), requestId });
  });
}
