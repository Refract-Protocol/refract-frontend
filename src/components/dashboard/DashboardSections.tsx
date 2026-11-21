"use client";

import { memo, useState } from "react";
import { cn } from "@/lib/cn";
import {
  UNHIDEABLE_SECTIONS,
  type DashboardSectionId,
  type DashboardSectionLayout,
} from "@/hooks/useDashboardLayout";

const SECTION_TITLES: Record<DashboardSectionId, string> = {
  summary: "Summary",
  policies: "Policies",
  claims: "Claims",
};

interface DashboardSectionsProps {
  layout: DashboardSectionLayout[];
  sections: Record<DashboardSectionId, React.ReactNode>;
  onMove: (from: number, to: number) => void;
  onToggleHidden: (id: DashboardSectionId) => void;
}

const controlClass =
  "flex h-7 min-w-7 items-center justify-center rounded-md border border-pm-border px-2 text-[11px] text-pm-text/55 transition-colors hover:border-pm-border-2 hover:text-pm-text disabled:opacity-30 disabled:hover:text-pm-text/55";

interface DashboardSectionProps {
  id: DashboardSectionId;
  index: number;
  total: number;
  hidden: boolean;
  content: React.ReactNode;
  dragIndex: number | null;
  overIndex: number | null;
  onDragStart: (index: number) => void;
  onDragEnd: () => void;
  onDragOver: (index: number) => void;
  onDrop: (index: number) => void;
  onMove: (from: number, to: number) => void;
  onToggleHidden: (id: DashboardSectionId) => void;
}

/**
 * A single dashboard section. Memoized so that when one stat updates (and only
 * its `content` node changes), unrelated sections skip re-rendering.
 */
const DashboardSection = memo(function DashboardSection({
  id,
  index,
  total,
  hidden,
  content,
  dragIndex,
  overIndex,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  onMove,
  onToggleHidden,
}: DashboardSectionProps) {
  const title = SECTION_TITLES[id];
  const hideable = !UNHIDEABLE_SECTIONS.includes(id);

  return (
    <div
      onDragOver={(e) => {
        if (dragIndex === null) return;
        e.preventDefault();
        onDragOver(index);
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDrop(index);
      }}
      className={cn(
        "rounded-lg transition-opacity",
        dragIndex === index && "opacity-50",
        overIndex === index && dragIndex !== index && "outline outline-1 outline-pm-violet/50"
      )}
    >
      <div className="mb-2 flex items-center justify-end gap-1.5" role="group" aria-label={`${title} section layout`}>
        <span
          draggable
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", id);
            onDragStart(index);
          }}
          onDragEnd={onDragEnd}
          className="mr-auto cursor-grab select-none px-1 text-sm text-pm-text/35 active:cursor-grabbing"
          title={`Drag to reorder ${title}`}
          aria-hidden="true"
        >
          ⠿ <span className="text-[11px] uppercase tracking-wide">{title}</span>
        </span>
        <button
          type="button"
          className={controlClass}
          onClick={() => onMove(index, index - 1)}
          disabled={index === 0}
          aria-label={`Move ${title} up`}
        >
          ↑
        </button>
        <button
          type="button"
          className={controlClass}
          onClick={() => onMove(index, index + 1)}
          disabled={index === total - 1}
          aria-label={`Move ${title} down`}
        >
          ↓
        </button>
        {hideable && (
          <button
            type="button"
            className={controlClass}
            onClick={() => onToggleHidden(id)}
            aria-pressed={hidden}
            aria-label={hidden ? `Show ${title}` : `Hide ${title}`}
          >
            {hidden ? "Show" : "Hide"}
          </button>
        )}
      </div>
      {hidden ? (
        <p className="mb-7 rounded-lg border border-dashed border-pm-border px-4 py-3 text-xs text-pm-text/40">
          {title} hidden
        </p>
      ) : (
        content
      )}
    </div>
  );
});

/**
 * Renders Dashboard sections in the user's chosen order. Each section can be
 * reordered by native HTML5 drag-and-drop on its handle, or with the
 * keyboard-operable "move up"/"move down" buttons, and (except Summary) hidden.
 *
 * Each section is rendered through a memoized `DashboardSection`, so a stat
 * update that only changes one section's `content` node does not re-render the
 * unrelated sections.
 */
export function DashboardSections({ layout, sections, onMove, onToggleHidden }: DashboardSectionsProps) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  const handleDragStart = (index: number) => setDragIndex(index);
  const handleDragEnd = () => {
    setDragIndex(null);
    setOverIndex(null);
  };
  const handleDragOver = (index: number) => setOverIndex(index);
  const handleDrop = (index: number) => {
    if (dragIndex !== null) onMove(dragIndex, index);
    setDragIndex(null);
    setOverIndex(null);
  };

  return (
    <div className="flex flex-col">
      {layout.map((item, index) => (
        <DashboardSection
          key={item.id}
          id={item.id}
          index={index}
          total={layout.length}
          hidden={item.hidden}
          content={sections[item.id]}
          dragIndex={dragIndex}
          overIndex={overIndex}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onMove={onMove}
          onToggleHidden={onToggleHidden}
        />
      ))}
    </div>
  );
}
