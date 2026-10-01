"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CommandItem, STATIC_COMMANDS, searchCommands, wrapIndex } from "@/lib/commands";

export function CommandPalette() {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const results = useMemo(() => {
    return searchCommands(query, STATIC_COMMANDS);
  }, [query]);

  // Reset selection index when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [results]);

  // Global keyboard shortcut: Cmd+K / Ctrl+K
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setIsOpen((open) => !open);
      } else if (e.key === "Escape" && isOpen) {
        e.preventDefault();
        setIsOpen(false);
      }
    }

    function handleCustomOpen() {
      setIsOpen(true);
    }

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("refract:open-command-palette", handleCustomOpen);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("refract:open-command-palette", handleCustomOpen);
    };
  }, [isOpen]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Scroll active item into view
  useEffect(() => {
    if (!isOpen || !listRef.current) return;
    const activeEl = listRef.current.children[selectedIndex] as HTMLElement;
    if (activeEl) {
      activeEl.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex, isOpen]);

  const executeCommand = (cmd: CommandItem) => {
    setIsOpen(false);
    if (cmd.action) {
      cmd.action();
    } else if (cmd.href) {
      router.push(cmd.href);
    }
  };

  const handleInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((idx) => wrapIndex(idx, 1, results.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((idx) => wrapIndex(idx, -1, results.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (results[selectedIndex]) {
        executeCommand(results[selectedIndex]);
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Command Palette"
      className="fixed inset-0 z-50 flex items-start justify-center pt-20 sm:pt-28 px-4"
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/70 backdrop-blur-sm transition-opacity"
        onClick={() => setIsOpen(false)}
        aria-hidden="true"
      />

      {/* Palette Box */}
      <div className="relative w-full max-w-xl overflow-hidden rounded-xl border border-pm-violet/30 bg-[#0c0919]/95 shadow-[0_0_50px_rgba(139,92,246,0.18)] backdrop-blur-xl animate-scale-in">
        {/* Search Header */}
        <div className="flex items-center border-b border-white/[0.08] px-4 py-3.5">
          <span className="text-pm-violet text-lg mr-3" aria-hidden="true">🔍</span>
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls="command-list"
            aria-activedescendant={results[selectedIndex] ? `cmd-${results[selectedIndex].id}` : undefined}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder="Type a command or search..."
            className="w-full bg-transparent text-sm text-pm-text placeholder-pm-text/40 focus:outline-none"
          />
          <kbd className="hidden sm:inline-flex items-center gap-1 rounded bg-white/[0.06] px-2 py-0.5 text-[10px] font-mono text-pm-text/50">
            ESC
          </kbd>
        </div>

        {/* Results List */}
        <div className="max-h-[360px] overflow-y-auto p-2">
          {results.length === 0 ? (
            <div className="py-10 text-center text-sm text-pm-text/40">
              No matching commands found for &ldquo;{query}&rdquo;
            </div>
          ) : (
            <ul id="command-list" role="listbox" ref={listRef} className="flex flex-col gap-1">
              {results.map((cmd, idx) => {
                const isSelected = idx === selectedIndex;
                return (
                  <li
                    key={cmd.id}
                    id={`cmd-${cmd.id}`}
                    role="option"
                    aria-selected={isSelected}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    onClick={() => executeCommand(cmd)}
                    className={`flex items-center justify-between rounded-lg px-3 py-2.5 cursor-pointer text-left transition-all ${
                      isSelected
                        ? "bg-pm-violet/20 text-pm-text shadow-[0_0_12px_rgba(139,92,246,0.25)] border border-pm-violet/40"
                        : "text-pm-text/80 hover:bg-white/[0.04] border border-transparent"
                    }`}
                  >
                    <div className="flex items-center gap-3 truncate">
                      {cmd.icon && <span className="text-base" aria-hidden="true">{cmd.icon}</span>}
                      <div className="truncate">
                        <div className="text-xs font-semibold text-pm-text truncate">{cmd.label}</div>
                        {cmd.description && (
                          <div className="text-[11px] text-pm-text/40 truncate">{cmd.description}</div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 ml-3 shrink-0">
                      <span className="rounded bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-pm-text/45 uppercase tracking-wider">
                        {cmd.category}
                      </span>
                      {isSelected && (
                        <span className="text-[11px] text-pm-violet font-semibold">↵</span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Footer shortcuts */}
        <div className="flex items-center justify-between border-t border-white/[0.06] bg-black/40 px-4 py-2 text-[10px] text-pm-text/40">
          <div className="flex items-center gap-3">
            <span>↑↓ to navigate</span>
            <span>↵ to select</span>
          </div>
          <div>
            <span>Refract Command Menu</span>
          </div>
        </div>
      </div>
    </div>
  );
}
