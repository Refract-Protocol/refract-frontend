"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "@/lib/wallet/WalletProvider";
import { useHolderPolicies } from "@/hooks/useHolderPolicies";
import { useClaims } from "@/hooks/useClaims";
import { useCoverageTypes } from "@/hooks/useCoverageTypes";
import { fuzzySearch } from "@/lib/fuzzySearch";
import { formatUsd, fromStroops } from "@/lib/format";
import { cn } from "@/lib/cn";

interface SearchResult {
  key: string;
  label: string;
  detail: string;
  href: string;
}

interface SearchGroup {
  category: string;
  results: SearchResult[];
}

/**
 * Global client-side search, opened from the Navbar's search icon (or ⌘K /
 * Ctrl+K). Fuzzy-matches the connected holder's policies and claims plus the
 * coverage-type catalog; the Policies/Claims groups are simply absent while
 * the wallet is disconnected.
 */
export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  function close() {
    setOpen(false);
    buttonRef.current?.focus();
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-9 w-9 items-center justify-center rounded-md border border-pm-border text-pm-text/60 transition-colors hover:text-pm-text"
        aria-label="Search policies, claims, and coverage types"
        aria-haspopup="dialog"
        title="Search (⌘K)"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" strokeLinecap="round" />
        </svg>
      </button>
      {open && <SearchDialog onClose={close} />}
    </>
  );
}

function SearchDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const wallet = useWallet();
  const address = wallet.status === "connected" ? wallet.address : null;
  const { data: policies } = useHolderPolicies(address);
  const claims = useClaims(address, policies);
  const { data: coverageTypes } = useCoverageTypes();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const groups = useMemo(() => buildGroups(query, address ? policies ?? [] : null, address ? claims : null, coverageTypes ?? []), [query, address, policies, claims, coverageTypes]);
  const flat = groups.flatMap((g) => g.results);

  useEffect(() => setActive(0), [query]);

  function go(result: SearchResult) {
    onClose();
    router.push(result.href);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") onClose();
    else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, flat.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && flat[active]) go(flat[active]);
  }

  let index = -1;
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/60 px-4 pt-[12vh]" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        className="w-full max-w-[520px] overflow-hidden rounded-xl border border-pm-border bg-pm-bg shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={address ? "Search policies, claims, coverage types…" : "Search coverage types…"}
          className="w-full border-b border-pm-border bg-transparent px-4 py-3.5 text-sm text-pm-text outline-none placeholder:text-pm-text/35"
          role="combobox"
          aria-expanded={flat.length > 0}
          aria-controls="global-search-results"
          aria-activedescendant={flat[active] ? `search-${flat[active].key}` : undefined}
        />
        <div id="global-search-results" role="listbox" className="max-h-[50vh] overflow-y-auto p-2">
          {query.trim() && flat.length === 0 && <p className="px-3 py-6 text-center text-sm text-pm-text/45">No matches</p>}
          {groups.map((group) => (
            <div key={group.category} role="group" aria-label={group.category} className="mb-2 last:mb-0">
              <div className="px-3 py-1.5 text-[11px] uppercase tracking-wide text-pm-text/40">{group.category}</div>
              {group.results.map((r) => {
                index += 1;
                const i = index;
                return (
                  <div
                    key={r.key}
                    id={`search-${r.key}`}
                    role="option"
                    aria-selected={i === active}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => go(r)}
                    className={cn("cursor-pointer rounded-md px-3 py-2", i === active && "bg-pm-violet/10")}
                  >
                    <div className="truncate text-sm text-pm-text">{r.label}</div>
                    <div className="truncate text-xs text-pm-text/45">{r.detail}</div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Groups fuzzy results by category, omitting empty/unavailable groups. `null` means the group is unavailable. */
export function buildGroups(
  query: string,
  policies: { id: string; coverageTypeName: string; coverageAmount: string }[] | null,
  claims: { policyId: string; reason: string; payout: string }[] | null,
  coverageTypes: { id: number; name: string; description: string; trigger: string }[]
): SearchGroup[] {
  const groups: SearchGroup[] = [];
  if (policies) {
    groups.push({
      category: "Policies",
      results: fuzzySearch(policies, query, (p) => [p.id, p.coverageTypeName]).map((p) => ({
        key: `policy-${p.id}`,
        label: p.coverageTypeName,
        detail: `${p.id} · ${formatUsd(fromStroops(p.coverageAmount))} coverage`,
        href: "/dashboard",
      })),
    });
  }
  if (claims) {
    groups.push({
      category: "Claims",
      results: fuzzySearch(claims, query, (c) => [c.policyId, c.reason]).map((c) => ({
        key: `claim-${c.policyId}`,
        label: c.reason,
        detail: `${c.policyId} · ${formatUsd(fromStroops(c.payout))} payout`,
        href: "/dashboard",
      })),
    });
  }
  groups.push({
    category: "Coverage Types",
    results: fuzzySearch(coverageTypes, query, (t) => [t.name, t.description, t.trigger]).map((t) => ({
      key: `type-${t.id}`,
      label: t.name,
      detail: t.description,
      href: "/cover",
    })),
  });
  return groups.filter((g) => g.results.length > 0);
}
