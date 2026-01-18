/**
 * Outline Keyboard Navigation Hook
 *
 * Handles keyboard navigation for the outline view.
 * Supports j/k or arrow keys, Enter for navigation, and arrow keys for collapse toggle.
 */

import { useEffect, useCallback, useMemo } from "react";
import { useOutlineStore } from "@/stores/outline-store";
import { useFileStore } from "@/stores/file-store";
import type { Heading, HeadingNode } from "../types";
import { buildTree } from "../use-tree";

interface UseOutlineKeyboardOptions {
  headings: Heading[];
  onNavigate: (heading: Heading) => void;
  isActive: boolean; // Whether the outline panel is focused/active
}

/**
 * Flatten visible nodes (respecting collapsed state)
 */
function flattenVisibleNodes(
  nodes: HeadingNode[],
  collapsedNodes: Set<string>
): HeadingNode[] {
  const result: HeadingNode[] = [];

  function traverse(node: HeadingNode) {
    result.push(node);
    if (!collapsedNodes.has(node.id)) {
      for (const child of node.children) {
        traverse(child);
      }
    }
  }

  for (const node of nodes) {
    traverse(node);
  }

  return result;
}

/**
 * Find a node by ID in the tree
 */
function findNodeById(nodes: HeadingNode[], id: string): HeadingNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const found = findNodeById(node.children, id);
    if (found) return found;
  }
  return null;
}

/**
 * Hook for handling keyboard navigation in the outline
 */
export function useOutlineKeyboard({
  headings,
  onNavigate,
  isActive,
}: UseOutlineKeyboardOptions) {
  const { currentFileId } = useFileStore();
  const {
    selectedNodeId,
    setSelectedNode,
    toggleCollapse,
    getCollapsedNodes,
  } = useOutlineStore();

  const documentId = currentFileId || "default";

  // Build tree and get visible nodes
  const tree = useMemo(() => buildTree(headings), [headings]);
  const collapsedNodes = getCollapsedNodes(documentId);

  const visibleNodes = useMemo(
    () => flattenVisibleNodes(tree, collapsedNodes),
    [tree, collapsedNodes]
  );

  // Navigate to next/previous visible node
  const navigateToIndex = useCallback(
    (delta: number) => {
      if (visibleNodes.length === 0) return;

      const currentIndex = selectedNodeId
        ? visibleNodes.findIndex((n) => n.id === selectedNodeId)
        : -1;

      let nextIndex: number;
      if (currentIndex === -1) {
        // No selection, start from first
        nextIndex = delta > 0 ? 0 : visibleNodes.length - 1;
      } else {
        nextIndex = currentIndex + delta;
        // Clamp to bounds
        if (nextIndex < 0) nextIndex = 0;
        if (nextIndex >= visibleNodes.length) nextIndex = visibleNodes.length - 1;
      }

      setSelectedNode(visibleNodes[nextIndex].id);
    },
    [visibleNodes, selectedNodeId, setSelectedNode]
  );

  // Handle collapse/expand
  const handleCollapseExpand = useCallback(
    (expand: boolean) => {
      if (!selectedNodeId) return;

      const node = findNodeById(tree, selectedNodeId);
      if (!node || node.children.length === 0) return;

      const isCurrentlyCollapsed = collapsedNodes.has(selectedNodeId);

      // ArrowRight expands, ArrowLeft collapses
      if (expand && isCurrentlyCollapsed) {
        toggleCollapse(documentId, selectedNodeId);
      } else if (!expand && !isCurrentlyCollapsed) {
        toggleCollapse(documentId, selectedNodeId);
      }
    },
    [selectedNodeId, tree, collapsedNodes, documentId, toggleCollapse]
  );

  // Handle navigation to editor
  const handleEnter = useCallback(() => {
    if (!selectedNodeId) return;

    const node = visibleNodes.find((n) => n.id === selectedNodeId);
    if (node) {
      onNavigate(node);
    }
  }, [selectedNodeId, visibleNodes, onNavigate]);

  useEffect(() => {
    if (!isActive) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't capture if user is typing in an input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      switch (e.key) {
        case "j":
        case "ArrowDown":
          e.preventDefault();
          navigateToIndex(1);
          break;
        case "k":
        case "ArrowUp":
          e.preventDefault();
          navigateToIndex(-1);
          break;
        case "ArrowRight":
          e.preventDefault();
          handleCollapseExpand(true); // Expand
          break;
        case "ArrowLeft":
          e.preventDefault();
          handleCollapseExpand(false); // Collapse
          break;
        case "Enter":
          e.preventDefault();
          handleEnter();
          break;
        default:
          return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isActive, navigateToIndex, handleCollapseExpand, handleEnter]);

  return {
    selectedNodeId,
    setSelectedNode,
    navigateToIndex,
    handleEnter,
  };
}
