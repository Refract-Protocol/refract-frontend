"use client";

import { motion } from "framer-motion";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";

const PARTICLES = Array.from({ length: 8 }, (_, i) => (i / 8) * Math.PI * 2);

/**
 * Reusable success mark: a checkmark that draws in with a brief pulse and
 * particle burst. Purely decorative and additive — it never delays the
 * surrounding content. With prefers-reduced-motion it renders the static
 * end state immediately (no animation).
 */
export function SuccessBurst({ size = 28 }: { size?: number }) {
  const reduced = usePrefersReducedMotion();

  const check = (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" data-testid="success-check">
      <circle cx="12" cy="12" r="11" stroke="currentColor" strokeOpacity="0.35" strokeWidth="1.5" />
      {reduced ? (
        <path d="M7 12.5l3.2 3.2L17 9" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <motion.path
          d="M7 12.5l3.2 3.2L17 9"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.4, ease: "easeOut", delay: 0.1 }}
        />
      )}
    </svg>
  );

  if (reduced) {
    return (
      <span className="relative inline-flex" aria-hidden="true" data-motion="static">
        {check}
      </span>
    );
  }

  return (
    <span className="relative inline-flex" aria-hidden="true" data-motion="animated">
      <motion.span
        className="absolute inset-0 rounded-full bg-current"
        initial={{ scale: 0.6, opacity: 0.35 }}
        animate={{ scale: 1.9, opacity: 0 }}
        transition={{ duration: 0.7, ease: "easeOut" }}
      />
      {PARTICLES.map((angle) => (
        <motion.span
          key={angle}
          className="absolute left-1/2 top-1/2 h-1 w-1 rounded-full bg-current"
          initial={{ x: "-50%", y: "-50%", opacity: 1 }}
          animate={{ x: Math.cos(angle) * size * 0.9, y: Math.sin(angle) * size * 0.9, opacity: 0 }}
          transition={{ duration: 0.6, ease: "easeOut", delay: 0.15 }}
        />
      ))}
      <motion.span initial={{ scale: 0.8 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 400, damping: 15 }}>
        {check}
      </motion.span>
    </span>
  );
}
