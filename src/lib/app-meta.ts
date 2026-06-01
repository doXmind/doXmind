import packageJson from "../../package.json";

export const APP_VERSION = (packageJson as { version: string }).version;

// Build date — pinned at module load. For a Tauri-bundled build this is the
// time the JS bundle was generated, which is close enough to the build date
// for the About panel.
export const APP_BUILD = new Date().toISOString().slice(0, 10);

export const APP_PROVIDER = "Waxis Inc.";

export const APP_CHANNEL = "Stable";
