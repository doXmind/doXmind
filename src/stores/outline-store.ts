import { create } from "zustand";
import { persist } from "zustand/middleware";

interface OutlineState {
  // Collapsed nodes per document (documentId -> Set of node IDs)
  collapsedNodes: Record<string, string[]>;

  // Currently selected node in outline
  selectedNodeId: string | null;

  // Actions
  toggleCollapse: (documentId: string, nodeId: string) => void;
  setCollapsed: (documentId: string, nodeIds: string[]) => void;
  expandAll: (documentId: string) => void;
  collapseAll: (documentId: string, nodeIds: string[]) => void;
  setSelectedNode: (nodeId: string | null) => void;
  isCollapsed: (documentId: string, nodeId: string) => boolean;
  getCollapsedNodes: (documentId: string) => Set<string>;
}

export const useOutlineStore = create<OutlineState>()(
  persist(
    (set, get) => ({
      collapsedNodes: {},
      selectedNodeId: null,

      toggleCollapse: (documentId: string, nodeId: string) => {
        set((state) => {
          const docNodes = state.collapsedNodes[documentId] || [];
          const nodeSet = new Set(docNodes);

          if (nodeSet.has(nodeId)) {
            nodeSet.delete(nodeId);
          } else {
            nodeSet.add(nodeId);
          }

          return {
            collapsedNodes: {
              ...state.collapsedNodes,
              [documentId]: Array.from(nodeSet),
            },
          };
        });
      },

      setCollapsed: (documentId: string, nodeIds: string[]) => {
        set((state) => ({
          collapsedNodes: {
            ...state.collapsedNodes,
            [documentId]: nodeIds,
          },
        }));
      },

      expandAll: (documentId: string) => {
        set((state) => ({
          collapsedNodes: {
            ...state.collapsedNodes,
            [documentId]: [],
          },
        }));
      },

      collapseAll: (documentId: string, nodeIds: string[]) => {
        set((state) => ({
          collapsedNodes: {
            ...state.collapsedNodes,
            [documentId]: nodeIds,
          },
        }));
      },

      setSelectedNode: (nodeId: string | null) => {
        set({ selectedNodeId: nodeId });
      },

      isCollapsed: (documentId: string, nodeId: string) => {
        const docNodes = get().collapsedNodes[documentId] || [];
        return docNodes.includes(nodeId);
      },

      getCollapsedNodes: (documentId: string) => {
        const docNodes = get().collapsedNodes[documentId] || [];
        return new Set(docNodes);
      },
    }),
    {
      name: "doxmind-outline",
      partialize: (state) => ({
        collapsedNodes: state.collapsedNodes,
      }),
    }
  )
);
