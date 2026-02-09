/**
 * Mindmap Keyboard Navigation Hook
 *
 * Handles keyboard navigation for the mindmap visualization.
 * Supports arrow keys, Enter for navigation, and Space for collapse toggle.
 */

import { useEffect, useCallback } from "react";
import type { Node } from "@xyflow/react";
import { MINDMAP_CENTER_VIEW } from "@/lib/constants";
import type { FlowNodeData, Heading } from "../types";

interface UseMindmapKeyboardOptions {
  nodes: Node[];
  selectedNodeId: string | null;
  setSelectedNodeId: (id: string | null) => void;
  setCenter: (x: number, y: number, options?: { zoom?: number; duration?: number }) => void;
  onNodeClick: (heading: Heading) => void;
  setCollapsedNodes: React.Dispatch<React.SetStateAction<Set<string>>>;
}

/**
 * Hook for handling keyboard navigation in the mindmap
 */
export function useMindmapKeyboard({
  nodes,
  selectedNodeId,
  setSelectedNodeId,
  setCenter,
  onNodeClick,
  setCollapsedNodes,
}: UseMindmapKeyboardOptions) {
  // Navigate to a specific node
  const navigateToNode = useCallback(
    (node: Node) => {
      setSelectedNodeId(node.id);
      setCenter(
        node.position.x + MINDMAP_CENTER_VIEW.X_OFFSET,
        node.position.y + MINDMAP_CENTER_VIEW.Y_OFFSET,
        {
          zoom: MINDMAP_CENTER_VIEW.ZOOM,
          duration: MINDMAP_CENTER_VIEW.NAV_DURATION,
        }
      );
    },
    [setSelectedNodeId, setCenter]
  );

  // Toggle collapse state of a node
  const toggleCollapse = useCallback(
    (nodeId: string) => {
      setCollapsedNodes((prev) => {
        const next = new Set(prev);
        if (next.has(nodeId)) {
          next.delete(nodeId);
        } else {
          next.add(nodeId);
        }
        return next;
      });
    },
    [setCollapsedNodes]
  );

  // Handle node selection via Enter key
  const handleNodeSelect = useCallback(() => {
    if (!selectedNodeId) return;

    const node = nodes.find((n) => n.id === selectedNodeId);
    if (node) {
      const data = node.data as FlowNodeData;
      onNodeClick({
        id: node.id,
        level: data.level,
        text: data.label,
        pos: data.pos,
      });
    }
  }, [selectedNodeId, nodes, onNodeClick]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!nodes.length) return;

      // Find current node index
      const currentIndex = selectedNodeId ? nodes.findIndex((n) => n.id === selectedNodeId) : -1;

      let nextIndex = currentIndex;

      switch (e.key) {
        case "ArrowUp":
        case "ArrowLeft":
          e.preventDefault();
          nextIndex = currentIndex > 0 ? currentIndex - 1 : nodes.length - 1;
          break;
        case "ArrowDown":
        case "ArrowRight":
          e.preventDefault();
          nextIndex = currentIndex < nodes.length - 1 ? currentIndex + 1 : 0;
          break;
        case "Enter":
          e.preventDefault();
          handleNodeSelect();
          return;
        case " ": // Space to toggle collapse
          e.preventDefault();
          if (selectedNodeId) {
            toggleCollapse(selectedNodeId);
          }
          return;
        default:
          return;
      }

      const nextNode = nodes[nextIndex];
      if (nextNode) {
        navigateToNode(nextNode);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [nodes, selectedNodeId, handleNodeSelect, toggleCollapse, navigateToNode]);

  return {
    navigateToNode,
    toggleCollapse,
    handleNodeSelect,
  };
}
