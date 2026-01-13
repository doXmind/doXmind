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
