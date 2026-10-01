export interface CommandItem {
  id: string;
  label: string;
  description?: string;
  keywords?: string[];
  category: "Navigation" | "Coverage" | "Capital" | "Actions";
  href?: string;
  action?: () => void;
  icon?: string;
}

export const STATIC_COMMANDS: CommandItem[] = [
  // Navigation
  {
    id: "nav-home",
    label: "Home",
    description: "Go to landing page",
    category: "Navigation",
    href: "/",
    icon: "🏠",
    keywords: ["landing", "main", "start"],
  },
  {
    id: "nav-cover",
    label: "Get Coverage",
    description: "Browse and buy parametric insurance",
    category: "Navigation",
    href: "/cover",
    icon: "🛡️",
    keywords: ["buy", "purchase", "policy", "insurance", "cover"],
  },
  {
    id: "nav-compare",
    label: "Compare Coverage Plans",
    description: "Side-by-side comparison of coverage terms and premiums",
    category: "Navigation",
    href: "/cover/compare",
    icon: "⚖️",
    keywords: ["compare", "quotes", "plans", "rates", "table"],
  },
  {
    id: "nav-provide",
    label: "Provide Capital",
    description: "Deposit USDC to underwrite policies and earn yield",
    category: "Navigation",
    href: "/provide",
    icon: "💎",
    keywords: ["lp", "pool", "deposit", "earn", "yield", "underwrite", "liquidity"],
  },
  {
    id: "nav-dashboard",
    label: "Dashboard",
    description: "View your active policies, claims, and risk metrics",
    category: "Navigation",
    href: "/dashboard",
    icon: "📊",
    keywords: ["portfolio", "policies", "claims", "payouts", "history", "risk"],
  },

  // Quick Actions - Coverage
  {
    id: "action-cover-depeg",
    label: "Buy Stablecoin Depeg coverage",
    description: "Coverage against USDC depeg below $0.95",
    category: "Coverage",
    href: "/cover?type=0",
    icon: "🪙",
    keywords: ["stablecoin", "depeg", "usdc", "dollar"],
  },
  {
    id: "action-cover-crash",
    label: "Buy Market Crash coverage",
    description: "Coverage against market downturn >30%",
    category: "Coverage",
    href: "/cover?type=1",
    icon: "📉",
    keywords: ["crash", "market", "downturn", "drop"],
  },
  {
    id: "action-cover-shield",
    label: "Buy Liquidation Shield coverage",
    description: "Protection against DeFi position liquidation",
    category: "Coverage",
    href: "/cover?type=2",
    icon: "🛡️",
    keywords: ["liquidation", "shield", "defi", "margin", "collateral"],
  },
  {
    id: "action-cover-smart-contract",
    label: "Buy Smart Contract Risk coverage",
    description: "Protection against protocol exploits and hacks",
    category: "Coverage",
    href: "/cover?type=3",
    icon: "🔐",
    keywords: ["exploit", "hack", "smart contract", "security", "bug"],
  },
  {
    id: "action-cover-flight",
    label: "Buy Flight Delay coverage",
    description: "Automatic payout for flights delayed >2h",
    category: "Coverage",
    href: "/cover?type=4",
    icon: "✈️",
    keywords: ["flight", "airline", "delay", "travel", "plane"],
  },

  // Quick Actions - Capital
  {
    id: "action-provide-deposit",
    label: "Deposit Capital into Pool",
    description: "Provide USDC liquidity to earn underwriting yield",
    category: "Capital",
    href: "/provide",
    icon: "➕",
    keywords: ["deposit", "add liquidity", "invest", "provide capital"],
  },
  {
    id: "action-provide-withdraw",
    label: "Withdraw Capital",
    description: "Redeem PPS pool shares for USDC",
    category: "Capital",
    href: "/provide",
    icon: "➖",
    keywords: ["withdraw", "redeem", "cash out"],
  },
];

/**
 * Calculates a match score for a given target string against a query.
 * Higher score means better match. 0 means no match.
 */
export function calculateMatchScore(query: string, target: string): number {
  const q = query.trim().toLowerCase();
  const t = target.toLowerCase();

  if (!q) return 1;
  if (t === q) return 1000;
  if (t.startsWith(q)) return 500;

  // Word boundary match (e.g., "dc" matches "Deposit Capital")
  const words = t.split(/[\s-_]+/);
  for (const word of words) {
    if (word.startsWith(q)) return 300;
  }

  // Substring match
  const idx = t.indexOf(q);
  if (idx !== -1) {
    return 100 - idx;
  }

  // Subsequence match (fuzzy)
  let qIdx = 0;
  let score = 0;
  for (let i = 0; i < t.length && qIdx < q.length; i++) {
    if (t[i] === q[qIdx]) {
      score += 10;
      qIdx++;
    }
  }

  if (qIdx === q.length) {
    return score;
  }

  return 0;
}

/**
 * Fuzzy searches command registry and returns items ordered by relevance.
 */
export function searchCommands(query: string, commands: CommandItem[] = STATIC_COMMANDS): CommandItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return commands;

  const scored = commands
    .map((cmd) => {
      let maxScore = calculateMatchScore(q, cmd.label);

      if (cmd.description) {
        const descScore = calculateMatchScore(q, cmd.description) * 0.6;
        if (descScore > maxScore) maxScore = descScore;
      }

      if (cmd.keywords) {
        for (const kw of cmd.keywords) {
          const kwScore = calculateMatchScore(q, kw) * 0.8;
          if (kwScore > maxScore) maxScore = kwScore;
        }
      }

      const catScore = calculateMatchScore(q, cmd.category) * 0.4;
      if (catScore > maxScore) maxScore = catScore;

      return { cmd, score: maxScore };
    })
    .filter((item) => item.score > 0);

  scored.sort((a, b) => b.score - a.score);
  return scored.map((item) => item.cmd);
}

/**
 * Wraps selection index around bounds when navigating with arrow keys.
 */
export function wrapIndex(currentIndex: number, delta: number, totalCount: number): number {
  if (totalCount <= 0) return 0;
  const next = (currentIndex + delta) % totalCount;
  return next < 0 ? next + totalCount : next;
}
