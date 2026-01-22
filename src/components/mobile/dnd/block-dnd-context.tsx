"use client";

/**
 * Block DnD Context
 *
 * Provider component that wraps the editor with @dnd-kit context.
 * Configures touch sensor and collision detection for block reordering.
 */

import {
  DndContext,
  closestCenter,
  TouchSensor,
  MouseSensor,
  useSensor,
  useSensors,
  MeasuringStrategy,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useBlockDnd } from "./use-block-dnd";
import { BlockDragOverlay } from "./block-drag-overlay";

interface BlockDndContextProps {
  children: React.ReactNode;
}

export function BlockDndContext({ children }: BlockDndContextProps) {
  const { blocks, activeBlock, handleDragStart, handleDragOver, handleDragEnd, handleDragCancel } =
    useBlockDnd();

  // Configure touch sensor with activation constraint
  // delay: 200ms hold before drag starts (prevents accidental drags)
  // tolerance: 5px movement allowed during delay period
  const sensors = useSensors(
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 200,
        tolerance: 5,
      },
    }),
    useSensor(MouseSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  // Block IDs for SortableContext
  const blockIds = blocks.map((b) => b.id);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
      measuring={{
        droppable: {
          strategy: MeasuringStrategy.Always,
        },
      }}
    >
      <SortableContext items={blockIds} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>

      <BlockDragOverlay activeBlock={activeBlock} />
    </DndContext>
  );
}
