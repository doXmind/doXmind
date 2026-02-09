"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  MiniMap,
  Background,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  useReactFlow,
  Panel,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  ArrowDownUp,
  Expand,
  Shrink,
  RotateCcw,
  ZoomIn,
  ZoomOut,
  Maximize,
  Minimize2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MINDMAP_FIT_VIEW, MINDMAP_CENTER_VIEW, ANIMATION_DURATION } from "@/lib/constants";
import { useOutlineStore } from "@/stores/outline-store";
import { useFileStore } from "@/stores/file-store";
import { HeadingNode } from "./flow-nodes/heading-node";
import { CustomEdge } from "./flow-nodes/custom-edge";
import { convertToFlowElements, applyDagreLayout } from "./utils/layout";
import { findCollapsibleHeadingIds, findHeadingsWithChildren } from "./utils/heading-utils";
import { useMindmapKeyboard } from "./hooks/use-mindmap-keyboard";
import type { Heading, LayoutDirection, FlowNodeData } from "./types";

// Define nodeTypes and edgeTypes OUTSIDE component to prevent re-renders
const nodeTypes = { heading: HeadingNode };
const edgeTypes = { customEdge: CustomEdge };

// Stable empty array to prevent infinite re-renders in Zustand selectors
const EMPTY_COLLAPSED_ARRAY: string[] = [];

interface MindmapFlowProps {
  headings: Heading[];
  activeId: string | null;
  onNodeClick: (heading: Heading) => void;
  onToggleView?: () => void;
  onClose?: () => void;
}

/**
 * Inner component that uses React Flow hooks
 */
function MindmapFlowInner({
  headings,
  activeId,
  onNodeClick,
  onToggleView,
  onClose,
}: MindmapFlowProps) {
  const { fitView, setCenter, getNode, zoomIn, zoomOut } = useReactFlow();
  const { currentFileId } = useFileStore();
  const documentId = currentFileId || "default";

  // Use shared store for collapsed nodes
  const { setCollapsed, toggleCollapse, selectedNodeId, setSelectedNode } = useOutlineStore();

  // Get raw collapsed nodes array from store (stable reference)
  const collapsedNodesArray = useOutlineStore(
    (state) => state.collapsedNodes[documentId] ?? EMPTY_COLLAPSED_ARRAY
  );

  // Create Set from array for use in components
  const collapsedNodes = useMemo(() => new Set(collapsedNodesArray), [collapsedNodesArray]);

  // Initialize collapsed nodes on first render if empty
  useEffect(() => {
    if (collapsedNodesArray.length === 0 && headings.length > 0) {
      const defaultCollapsed = findCollapsibleHeadingIds(headings);
      if (defaultCollapsed.length > 0) {
        setCollapsed(documentId, defaultCollapsed);
      }
    }
  }, [documentId, headings, collapsedNodesArray.length, setCollapsed]);

  const [direction, setDirection] = useState<LayoutDirection>("TB");

  // Convert headings to React Flow format with collapse support
  const { initialNodes, initialEdges } = useMemo(
    () => convertToFlowElements(headings, collapsedNodes),
    [headings, collapsedNodes]
  );

  const [nodes, setNodes, onNodesChange] = useNodesState([] as Node[]);
  const [edges, setEdges] = useEdgesState([] as Edge[]);

  // Handle collapse toggle from nodes via callback
  const handleToggleCollapse = useCallback(
    (nodeId: string) => {
      toggleCollapse(documentId, nodeId);
    },
    [documentId, toggleCollapse]
  );

  // Apply layout and update nodes when headings or direction change
  useEffect(() => {
    if (initialNodes.length === 0) {
      setNodes([]);
      setEdges([]);
      return;
    }

    const { nodes: layouted, edges: layoutedEdges } = applyDagreLayout(
      initialNodes,
      initialEdges,
      direction
    );
    setNodes(layouted);
    setEdges(layoutedEdges);
  }, [initialNodes, initialEdges, direction, setNodes, setEdges]);

  // Fit view after layout with animation - ensure content is centered and zoomed in
  useEffect(() => {
    if (nodes.length > 0) {
      const timer = setTimeout(() => {
        fitView({
          padding: MINDMAP_FIT_VIEW.PADDING,
          duration: MINDMAP_FIT_VIEW.DURATION,
          maxZoom: MINDMAP_FIT_VIEW.MAX_ZOOM,
          minZoom: MINDMAP_FIT_VIEW.MIN_ZOOM,
        });
      }, MINDMAP_FIT_VIEW.DELAY);
      return () => clearTimeout(timer);
    }
  }, [nodes.length, fitView, collapsedNodes, direction]);

  // Center on active node when it changes
  useEffect(() => {
    if (activeId && nodes.length > 0) {
      const node = getNode(activeId);
      if (node) {
        const timer = setTimeout(() => {
          setCenter(
            node.position.x + MINDMAP_CENTER_VIEW.X_OFFSET,
            node.position.y + MINDMAP_CENTER_VIEW.Y_OFFSET,
            {
              zoom: MINDMAP_CENTER_VIEW.ZOOM,
              duration: MINDMAP_CENTER_VIEW.CENTER_DURATION,
            }
          );
        }, MINDMAP_FIT_VIEW.DELAY);
        return () => clearTimeout(timer);
      }
    }
  }, [activeId, nodes.length, getNode, setCenter]);

  // Handle node click - only select, don't navigate
  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      setSelectedNode(node.id);
    },
    [setSelectedNode]
  );

  // Handle double click to navigate to editor
  const handleNodeDoubleClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      const data = node.data as FlowNodeData;
      onNodeClick?.({
        id: node.id,
        level: data.level,
        text: data.label,
        pos: data.pos,
      });
    },
    [onNodeClick]
  );

  // Create a wrapper for setCollapsedNodes that matches the expected signature
  const setCollapsedNodesWrapper = useCallback(
    (updater: React.SetStateAction<Set<string>>) => {
      if (typeof updater === "function") {
        const newSet = updater(collapsedNodes);
        setCollapsed(documentId, Array.from(newSet));
      } else {
        setCollapsed(documentId, Array.from(updater));
      }
    },
    [documentId, collapsedNodes, setCollapsed]
  );

  // Keyboard navigation (extracted to hook)
  useMindmapKeyboard({
    nodes,
    selectedNodeId,
    setSelectedNodeId: setSelectedNode,
    setCenter,
    onNodeClick,
    setCollapsedNodes: setCollapsedNodesWrapper,
  });

  // Add isActive, selected, and onToggleCollapse to nodes for styling and interaction
  const nodesWithState = useMemo(
    () =>
      nodes.map((n) => ({
        ...n,
        selected: n.id === selectedNodeId,
        data: {
          ...(n.data as FlowNodeData),
          isActive: n.id === activeId,
          onToggleCollapse: handleToggleCollapse,
        },
      })),
    [nodes, activeId, selectedNodeId, handleToggleCollapse]
  );

  // Toggle layout direction
  const toggleDirection = useCallback(() => {
    setDirection((prev) => (prev === "TB" ? "LR" : "TB"));
  }, []);

  // Expand all nodes
  const expandAll = useCallback(() => {
    setCollapsed(documentId, []);
  }, [documentId, setCollapsed]);

  // Collapse all nodes with children
  const collapseAll = useCallback(() => {
    const withChildren = findHeadingsWithChildren(headings).map((h) => h.id);
    setCollapsed(documentId, withChildren);
  }, [documentId, headings, setCollapsed]);

  // Reset view
  const resetView = useCallback(() => {
    fitView({ padding: 0.2, duration: ANIMATION_DURATION.SLOW });
  }, [fitView]);

  // Zoom handlers
  const handleZoomIn = useCallback(() => {
    zoomIn({ duration: 200 });
  }, [zoomIn]);

  const handleZoomOut = useCallback(() => {
    zoomOut({ duration: 200 });
  }, [zoomOut]);

  return (
    <ReactFlow
      nodes={nodesWithState}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodesChange={onNodesChange}
      onNodeClick={handleNodeClick}
      onNodeDoubleClick={handleNodeDoubleClick}
      fitView
      fitViewOptions={{
        padding: MINDMAP_FIT_VIEW.PADDING,
        maxZoom: MINDMAP_FIT_VIEW.MAX_ZOOM,
        minZoom: MINDMAP_FIT_VIEW.MIN_ZOOM,
      }}
      defaultViewport={{ x: 0, y: 0, zoom: 1 }}
      minZoom={0.1}
      maxZoom={2}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable
      panOnScroll
      zoomOnScroll
      onlyRenderVisibleElements // Performance: virtualization
      proOptions={{ hideAttribution: true }}
      className="bg-background"
    >
      <Background variant={BackgroundVariant.Dots} gap={20} size={1} className="!bg-background" />

      {/* Custom control panel */}
      <Panel position="top-right" className="flex gap-1">
        <Button
          variant="outline"
          size="icon"
          onClick={toggleDirection}
          title={`Switch to ${direction === "TB" ? "horizontal" : "vertical"} layout`}
          className="h-8 w-8 bg-background/80 backdrop-blur-sm"
        >
          <ArrowDownUp className={cn("h-4 w-4", direction === "LR" && "rotate-90")} />
        </Button>
        <Button
          variant="outline"
          size="icon"
          onClick={expandAll}
          title="Expand all"
          className="h-8 w-8 bg-background/80 backdrop-blur-sm"
        >
          <Expand className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          onClick={collapseAll}
          title="Collapse all"
          className="h-8 w-8 bg-background/80 backdrop-blur-sm"
        >
          <Shrink className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          onClick={resetView}
          title="Reset view"
          className="h-8 w-8 bg-background/80 backdrop-blur-sm"
        >
          <RotateCcw className="h-4 w-4" />
        </Button>

        {/* Separator */}
        {(onToggleView || onClose) && <div className="mx-1 h-8 w-px bg-border/50" />}

        {/* Toggle to outline view */}
        {onToggleView && (
          <Button
            variant="outline"
            size="icon"
            onClick={onToggleView}
            title="Collapse to outline"
            className="h-8 w-8 bg-background/80 backdrop-blur-sm"
          >
            <Minimize2 className="h-4 w-4" />
          </Button>
        )}

        {/* Close button */}
        {onClose && (
          <Button
            variant="outline"
            size="icon"
            onClick={onClose}
            title="Close"
            className="h-8 w-8 bg-background/80 backdrop-blur-sm"
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </Panel>

      {/* Zoom controls - top left */}
      <Panel position="top-left" className="flex flex-col gap-1">
        <Button
          variant="outline"
          size="icon"
          onClick={handleZoomIn}
          title="Zoom in"
          className="h-8 w-8 bg-background/80 backdrop-blur-sm"
        >
          <ZoomIn className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          onClick={handleZoomOut}
          title="Zoom out"
          className="h-8 w-8 bg-background/80 backdrop-blur-sm"
        >
          <ZoomOut className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          onClick={resetView}
          title="Fit view"
          className="h-8 w-8 bg-background/80 backdrop-blur-sm"
        >
          <Maximize className="h-4 w-4" />
        </Button>
      </Panel>

      {/* Keyboard shortcuts hint - bottom center */}
      <Panel
        position="bottom-center"
        className="mb-2 rounded bg-background/60 px-2 py-1 text-xs text-muted-foreground backdrop-blur-sm"
      >
        <span className="opacity-70">
          Click to select • Double-click to go • Space to collapse • ↑↓ Navigate
        </span>
      </Panel>

      {/* MiniMap in bottom-right corner */}
      <MiniMap
        pannable
        zoomable
        nodeStrokeWidth={3}
        position="bottom-right"
        className="!border !bg-background/80 !shadow-sm !backdrop-blur-sm"
        maskColor="hsl(var(--background) / 0.8)"
      />
    </ReactFlow>
  );
}

/**
 * MindmapFlow component - React Flow visualization of document structure
 * Wrapped in ReactFlowProvider for hook access
 */
export function MindmapFlow(props: MindmapFlowProps) {
  return (
    <ReactFlowProvider>
      <MindmapFlowInner {...props} />
    </ReactFlowProvider>
  );
}
