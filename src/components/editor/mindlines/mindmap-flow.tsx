"use client";

import { useCallback, useEffect, useMemo } from "react";
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
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { HeadingNode } from "./flow-nodes/heading-node";
import { convertToFlowElements, applyDagreLayout } from "./utils/layout";
import type { Heading } from "./types";

// Define nodeTypes OUTSIDE component to prevent re-renders
const nodeTypes = { heading: HeadingNode };

interface MindmapFlowProps {
  headings: Heading[];
  activeId: string | null;
  onNodeClick: (heading: Heading) => void;
}

/**
 * Inner component that uses React Flow hooks
 */
function MindmapFlowInner({ headings, activeId, onNodeClick }: MindmapFlowProps) {
  const { fitView } = useReactFlow();

  // Convert headings to React Flow format
  const { initialNodes, initialEdges } = useMemo(
    () => convertToFlowElements(headings),
    [headings]
  );

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges] = useEdgesState([]);

  // Apply layout and update nodes when headings change
  useEffect(() => {
    if (initialNodes.length === 0) {
      setNodes([]);
      setEdges([]);
      return;
    }

    const { nodes: layouted, edges: layoutedEdges } = applyDagreLayout(
      initialNodes,
      initialEdges,
      "TB" // Top to Bottom layout
    );
    setNodes(layouted);
    setEdges(layoutedEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  // Fit view after layout with a slight delay
  useEffect(() => {
    if (nodes.length > 0) {
      const timer = setTimeout(() => {
        fitView({ padding: 0.2, duration: 300 });
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [nodes.length, fitView]);

  // Handle node click to navigate
  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      onNodeClick?.({
        id: node.id,
        level: node.data.level as number,
        text: node.data.label as string,
        pos: node.data.pos as number,
      });
    },
    [onNodeClick]
  );

  // Add isActive property to nodes for styling
  const nodesWithActive = useMemo(
    () =>
      nodes.map((n) => ({
        ...n,
        data: { ...n.data, isActive: n.id === activeId },
      })),
    [nodes, activeId]
  );

  return (
    <ReactFlow
      nodes={nodesWithActive}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onNodeClick={handleNodeClick}
      fitView
      fitViewOptions={{ padding: 0.2 }}
      minZoom={0.1}
      maxZoom={2}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable
      panOnScroll
      zoomOnScroll
      proOptions={{ hideAttribution: true }}
    >
      <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
      <Controls showInteractive={false} />
      <MiniMap
        pannable
        zoomable
        nodeStrokeWidth={3}
        style={{
          backgroundColor: "hsl(var(--background))",
        }}
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
