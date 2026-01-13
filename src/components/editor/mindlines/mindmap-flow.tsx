"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Controls,
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
import { ArrowDownUp, Expand, Shrink, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  MINDMAP_FIT_VIEW,
  MINDMAP_CENTER_VIEW,
  ANIMATION_DURATION,
} from "@/lib/constants";
import { HeadingNode } from "./flow-nodes/heading-node";
import { CustomEdge } from "./flow-nodes/custom-edge";
import { convertToFlowElements, applyDagreLayout } from "./utils/layout";
import { findCollapsibleHeadingIds, findHeadingsWithChildren } from "./utils/heading-utils";
import { useMindmapKeyboard } from "./hooks/use-mindmap-keyboard";
import type { Heading, LayoutDirection, FlowNodeData } from "./types";

// Define nodeTypes and edgeTypes OUTSIDE component to prevent re-renders
const nodeTypes = { heading: HeadingNode };
const edgeTypes = { customEdge: CustomEdge };

interface MindmapFlowProps {
  headings: Heading[];
  activeId: string | null;
  onNodeClick: (heading: Heading) => void;
}

/**
 * Inner component that uses React Flow hooks
 */
function MindmapFlowInner({ headings, activeId, onNodeClick }: MindmapFlowProps) {
  const { fitView, setCenter, getNode } = useReactFlow();

  // State for collapsed nodes and layout direction
  // Default: show H1 and H2, collapse H2+ nodes that have children
  const [collapsedNodes, setCollapsedNodes] = useState<Set<string>>(
    () => new Set(findCollapsibleHeadingIds(headings))
  );
  const [direction, setDirection] = useState<LayoutDirection>("TB");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // Convert headings to React Flow format with collapse support
  const { initialNodes, initialEdges } = useMemo(
    () => convertToFlowElements(headings, collapsedNodes),
    [headings, collapsedNodes]
  );

  const [nodes, setNodes, onNodesChange] = useNodesState([] as Node[]);
  const [edges, setEdges] = useEdgesState([] as Edge[]);

  // Listen for collapse toggle events from nodes
  useEffect(() => {
    const handleToggleCollapse = (e: CustomEvent<{ nodeId: string }>) => {
      setCollapsedNodes((prev) => {
        const next = new Set(prev);
        if (next.has(e.detail.nodeId)) {
          next.delete(e.detail.nodeId);
        } else {
          next.add(e.detail.nodeId);
        }
        return next;
      });
    };

    window.addEventListener(
      "mindmap-toggle-collapse",
      handleToggleCollapse as EventListener
    );
    return () => {
      window.removeEventListener(
        "mindmap-toggle-collapse",
        handleToggleCollapse as EventListener
      );
    };
  }, []);

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
      setSelectedNodeId(node.id);
    },
    []
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

  // Keyboard navigation (extracted to hook)
  useMindmapKeyboard({
    nodes,
    selectedNodeId,
    setSelectedNodeId,
    setCenter,
    onNodeClick,
    setCollapsedNodes,
  });

  // Add isActive and selected properties to nodes for styling
  const nodesWithState = useMemo(
    () =>
      nodes.map((n) => ({
        ...n,
        selected: n.id === selectedNodeId,
        data: { ...(n.data as FlowNodeData), isActive: n.id === activeId },
      })),
    [nodes, activeId, selectedNodeId]
  );

  // Toggle layout direction
  const toggleDirection = useCallback(() => {
    setDirection((prev) => (prev === "TB" ? "LR" : "TB"));
  }, []);

  // Expand all nodes
  const expandAll = useCallback(() => {
    setCollapsedNodes(new Set());
  }, []);

  // Collapse all nodes with children
  const collapseAll = useCallback(() => {
    const withChildren = findHeadingsWithChildren(headings).map((h) => h.id);
    setCollapsedNodes(new Set(withChildren));
  }, [headings]);

  // Reset view
  const resetView = useCallback(() => {
    fitView({ padding: 0.2, duration: ANIMATION_DURATION.SLOW });
  }, [fitView]);

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
      </Panel>

      {/* Keyboard shortcuts hint - moved to bottom center */}
      <Panel position="bottom-center" className="text-xs text-muted-foreground bg-background/60 backdrop-blur-sm px-2 py-1 rounded mb-2">
        <span className="opacity-70">
          Click to select • Double-click to go • Space to collapse • ↑↓ Navigate
        </span>
      </Panel>

      {/* Controls moved to top-left to avoid overlap */}
      <Controls
        showInteractive={false}
        position="top-left"
        className="!bg-background/80 !backdrop-blur-sm !border !shadow-sm"
      />

      {/* MiniMap in bottom-right corner */}
      <MiniMap
        pannable
        zoomable
        nodeStrokeWidth={3}
        position="bottom-right"
        className="!bg-background/80 !backdrop-blur-sm !border !shadow-sm"
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
