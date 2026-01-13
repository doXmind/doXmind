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
import { HeadingNode } from "./flow-nodes/heading-node";
import { CustomEdge } from "./flow-nodes/custom-edge";
import { convertToFlowElements, applyDagreLayout } from "./utils/layout";
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
  const [collapsedNodes, setCollapsedNodes] = useState<Set<string>>(() => {
    const nodesWithChildren = headings
      .filter((h) => {
        // Only collapse H2 and below (level >= 2) that have children
        if (h.level < 2) return false; // Don't collapse H1
        const idx = headings.indexOf(h);
        for (let i = idx + 1; i < headings.length; i++) {
          if (headings[i].level <= h.level) break;
          if (headings[i].level > h.level) return true;
        }
        return false;
      })
      .map((h) => h.id);
    return new Set(nodesWithChildren);
  });
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
          padding: 0.15, // Less padding = more zoom
          duration: 300,
          maxZoom: 1.2, // Allow closer zoom
          minZoom: 0.8, // Don't zoom out too much
        });
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [nodes.length, fitView, collapsedNodes, direction]);

  // Center on active node when it changes
  useEffect(() => {
    if (activeId && nodes.length > 0) {
      const node = getNode(activeId);
      if (node) {
        const timer = setTimeout(() => {
          setCenter(node.position.x + 100, node.position.y + 22, {
            zoom: 1,
            duration: 500,
          });
        }, 100);
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

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!nodes.length) return;

      // Find current node index
      const currentIndex = selectedNodeId
        ? nodes.findIndex((n) => n.id === selectedNodeId)
        : -1;

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
          if (selectedNodeId) {
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
          }
          return;
        case " ": // Space to toggle collapse
          e.preventDefault();
          if (selectedNodeId) {
            setCollapsedNodes((prev) => {
              const next = new Set(prev);
              if (next.has(selectedNodeId)) {
                next.delete(selectedNodeId);
              } else {
                next.add(selectedNodeId);
              }
              return next;
            });
          }
          return;
        default:
          return;
      }

      const nextNode = nodes[nextIndex];
      if (nextNode) {
        setSelectedNodeId(nextNode.id);
        setCenter(nextNode.position.x + 100, nextNode.position.y + 22, {
          zoom: 1,
          duration: 200,
        });
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [nodes, selectedNodeId, setCenter, onNodeClick]);

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
    const nodesWithChildren = headings
      .filter((h) => {
        // Check if this heading has children (headings with higher level after it)
        const idx = headings.indexOf(h);
        for (let i = idx + 1; i < headings.length; i++) {
          if (headings[i].level <= h.level) break;
          if (headings[i].level > h.level) return true;
        }
        return false;
      })
      .map((h) => h.id);
    setCollapsedNodes(new Set(nodesWithChildren));
  }, [headings]);

  // Reset view
  const resetView = useCallback(() => {
    fitView({ padding: 0.2, duration: 300 });
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
        padding: 0.15,
        maxZoom: 1.2,
        minZoom: 0.8,
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
