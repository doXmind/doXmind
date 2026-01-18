// Mindlines type definitions

export interface Heading {
  id: string;
  level: number; // 1, 2, or 3
  text: string;
  pos: number;
}

export interface HeadingNode extends Heading {
  children: HeadingNode[];
  // Layout coordinates (set by d3-hierarchy)
  x?: number;
  y?: number;
}

// Point interface for layout calculations
export interface Point {
  x: number;
  y: number;
}

// Layout direction options
export type LayoutDirection = "TB" | "LR"; // Top-Bottom or Left-Right

// Mindmap configuration
export interface MindmapConfig {
  direction: LayoutDirection;
  collapsedNodes: Set<string>;
  showAnimation: boolean;
}

// Flow node data with enhanced properties
export interface FlowNodeData extends Record<string, unknown> {
  label: string;
  level: number;
  pos: number;
  isActive?: boolean;
  isCollapsed?: boolean;
  hasChildren?: boolean;
  childCount?: number;
  onToggleCollapse?: (nodeId: string) => void;
}
