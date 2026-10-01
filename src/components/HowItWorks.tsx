"use client";

import { useRef } from "react";
import { motion, useScroll, useTransform } from "framer-motion";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { Container, Card } from "@/components/ui";

export const HOW_IT_WORKS_STEPS = [
  {
    step: "01",
    icon: "🛡️",
    title: "Select & Deposit Premium",
    desc: "Pick your parametric coverage type, configure trigger conditions (e.g. flight delay, depeg), and deposit a one-time USDC premium directly into Soroban smart contracts.",
    highlight: "Non-custodial & locked in verifiable smart contracts",
  },
  {
    step: "02",
    icon: "📡",
    title: "Autonomous Oracle Monitoring",
    desc: "Decentralized oracle networks (Pyth & Chainlink) continuously ingest real-world data and evaluate trigger thresholds with sub-minute resolution.",
    highlight: "Zero human intervention or manual claims filing",
  },
  {
    step: "03",
    icon: "⚡",
    title: "Instant On-Chain Settlement",
    desc: "When an oracle records a trigger condition, the smart contract automatically executes payout settlement directly to your Stellar wallet in seconds.",
    highlight: "Automated instant payout directly to your wallet",
  },
];

export function HowItWorks() {
  const containerRef = useRef<HTMLDivElement>(null);
  const prefersReducedMotion = usePrefersReducedMotion();

  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start end", "end start"],
  });

  const step1Opacity = useTransform(scrollYProgress, [0.1, 0.3], [0.4, 1]);
  const step2Opacity = useTransform(scrollYProgress, [0.3, 0.55], [0.4, 1]);
  const step3Opacity = useTransform(scrollYProgress, [0.55, 0.8], [0.4, 1]);

  const step1Y = useTransform(scrollYProgress, [0.1, 0.3], [30, 0]);
  const step2Y = useTransform(scrollYProgress, [0.3, 0.55], [30, 0]);
  const step3Y = useTransform(scrollYProgress, [0.55, 0.8], [30, 0]);

  const stepTransforms = [
    { opacity: step1Opacity, y: step1Y },
    { opacity: step2Opacity, y: step2Y },
    { opacity: step3Opacity, y: step3Y },
  ];

  return (
    <section
      ref={containerRef}
      aria-labelledby="how-it-works-heading"
      className="border-b border-pm-border py-20 relative overflow-hidden"
    >
      <Container>
        <div className="mx-auto mb-14 max-w-2xl text-center">
          <div className="mb-2 text-[11px] font-bold uppercase tracking-widest text-pm-violet">
            Parametric Architecture
          </div>
          <h2
            id="how-it-works-heading"
            className="font-display text-2xl font-extrabold tracking-tight text-pm-text sm:text-3xl"
          >
            How Refract Works
          </h2>
          <p className="mt-3 text-sm text-pm-text/50">
            From policy origination to automated claims settlement in three trustless steps.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {HOW_IT_WORKS_STEPS.map((item, index) => {
            if (prefersReducedMotion) {
              return (
                <Card
                  key={item.step}
                  padding="lg"
                  className="relative flex flex-col justify-between border-white/10 bg-white/[0.02]"
                >
                  <div>
                    <div className="mb-4 flex items-center justify-between">
                      <span className="text-3xl" aria-hidden="true">
                        {item.icon}
                      </span>
                      <span className="font-mono text-xs font-bold text-pm-violet">
                        STEP {item.step}
                      </span>
                    </div>
                    <h3 className="mb-2 text-base font-bold text-pm-text">
                      {item.title}
                    </h3>
                    <p className="text-xs leading-relaxed text-pm-text/60">
                      {item.desc}
                    </p>
                  </div>
                  <div className="mt-6 rounded-md border border-pm-violet/15 bg-pm-violet/[0.05] px-3 py-2 text-[11px] font-medium text-pm-violet">
                    {item.highlight}
                  </div>
                </Card>
              );
            }

            const { opacity, y } = stepTransforms[index];

            return (
              <motion.div
                key={item.step}
                style={{ opacity, y }}
                className="h-full"
              >
                <Card
                  padding="lg"
                  className="relative flex h-full flex-col justify-between border-white/10 bg-white/[0.02] transition-colors hover:border-pm-violet/30"
                >
                  <div>
                    <div className="mb-4 flex items-center justify-between">
                      <span className="text-3xl" aria-hidden="true">
                        {item.icon}
                      </span>
                      <span className="font-mono text-xs font-bold text-pm-violet">
                        STEP {item.step}
                      </span>
                    </div>
                    <h3 className="mb-2 text-base font-bold text-pm-text">
                      {item.title}
                    </h3>
                    <p className="text-xs leading-relaxed text-pm-text/60">
                      {item.desc}
                    </p>
                  </div>
                  <div className="mt-6 rounded-md border border-pm-violet/15 bg-pm-violet/[0.05] px-3 py-2 text-[11px] font-medium text-pm-violet">
                    {item.highlight}
                  </div>
                </Card>
              </motion.div>
            );
          })}
        </div>
      </Container>
    </section>
  );
}
