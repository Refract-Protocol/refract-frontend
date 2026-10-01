"use client";

import { useState } from "react";
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

/**
 * Renders Dashboard sections in the user's chosen order. Each section can be
 * reordered by native HTML5 drag-and-drop on its handle, or with the
 * keyboard-operable "move up"/"move down" buttons, and (except Summary) hidden.
 */
export function DashboardSections({ layout, sections, onMove, onToggleHidden }: DashboardSectionsProps) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  return (
    <div className="flex flex-col">
      {layout.map((item, index) => {
        const title = SECTION_TITLES[item.id];
        const hideable = !UNHIDEABLE_SECTIONS.includes(item.id);
        return (
          <div
            key={item.id}
            onDragOver={(e) => {
              if (dragIndex === null) return;
              e.preventDefault();
              setOverIndex(index);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragIndex !== null) onMove(dragIndex, index);
              setDragIndex(null);
              setOverIndex(null);
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
                  e.dataTransfer.setData("text/plain", item.id);
                  setDragIndex(index);
                }}
                onDragEnd={() => {
                  setDragIndex(null);
                  setOverIndex(null);
                }}
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
                disabled={index === layout.length - 1}
                aria-label={`Move ${title} down`}
              >
                ↓
              </button>
              {hideable && (
                <button
                  type="button"
                  className={controlClass}
                  onClick={() => onToggleHidden(item.id)}
                  aria-pressed={item.hidden}
                  aria-label={item.hidden ? `Show ${title}` : `Hide ${title}`}
                >
                  {item.hidden ? "Show" : "Hide"}
                </button>
              )}
            </div>
            {item.hidden ? (
              <p className="mb-7 rounded-lg border border-dashed border-pm-border px-4 py-3 text-xs text-pm-text/40">
                {title} hidden
              </p>
            ) : (
              sections[item.id]
            )}
          </div>
        );
      })}
    </div>
  );
}
