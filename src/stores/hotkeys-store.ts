import { create } from "zustand";
import { persist } from "zustand/middleware";

import { WORKSPACE_COMMANDS, type WorkspaceCommand } from "@/lib/commands";

interface HotkeysState {
  /**
   * Only what the user changed. A command absent from this map uses its default, so changing a
   * default in a later release reaches everyone who never rebound it.
   *
   * `null` means deliberately unbound, which is different from absent.
   */
  overrides: Record<string, string | null>;

  setBinding: (commandId: string, binding: string | null) => void;
  resetBinding: (commandId: string) => void;
  resetAll: () => void;
}

export const useHotkeysStore = create<HotkeysState>()(
  persist(
    (set) => ({
      overrides: {},
      setBinding: (commandId, binding) =>
        set((state) => ({ overrides: { ...state.overrides, [commandId]: binding } })),
      resetBinding: (commandId) =>
        set((state) => {
          const { [commandId]: _removed, ...rest } = state.overrides;
          return { overrides: rest };
        }),
      resetAll: () => set({ overrides: {} }),
    }),
    { name: "doxmind-hotkeys" }
  )
);

/** The binding in force for `command`, honouring an override including a deliberate unbind. */
export function bindingFor(
  command: WorkspaceCommand,
  overrides: Record<string, string | null>
): string | null {
  return command.id in overrides ? overrides[command.id] : command.defaultBinding;
}

/**
 * Commands by the chord that runs them.
 *
 * Last writer wins on a conflict, and the settings page is what surfaces one — silently running
 * two commands from one chord would be worse than running the wrong one.
 */
export function commandsByBinding(
  overrides: Record<string, string | null>
): Map<string, WorkspaceCommand> {
  const map = new Map<string, WorkspaceCommand>();
  for (const command of WORKSPACE_COMMANDS) {
    const binding = bindingFor(command, overrides);
    if (binding) map.set(binding, command);
  }
  return map;
}

/** Command ids sharing a chord with another command, for the settings page to flag. */
export function conflictingCommandIds(
  overrides: Record<string, string | null>
): ReadonlySet<string> {
  const seen = new Map<string, string>();
  const conflicts = new Set<string>();
  for (const command of WORKSPACE_COMMANDS) {
    const binding = bindingFor(command, overrides);
    if (!binding) continue;
    const previous = seen.get(binding);
    if (previous) {
      conflicts.add(previous);
      conflicts.add(command.id);
    } else {
      seen.set(binding, command.id);
    }
  }
  return conflicts;
}
