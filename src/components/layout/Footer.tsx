import Link from "next/link";

const FOOTER_LINKS = [
  { label: "Coverage", href: "/cover" },
  { label: "Provide Capital", href: "/provide" },
  { label: "Dashboard", href: "/dashboard" },
  { label: "GitHub", href: "https://github.com/Refract-Protocol" },
];

export function Footer() {
  return (
    <footer className="border-t border-pm-border/60 px-4 py-9 sm:px-6 lg:px-7">
      <div className="mx-auto flex max-w-[1200px] flex-col items-center gap-4 text-center sm:flex-row sm:justify-between sm:text-left">
        <span className="text-xs text-pm-text/25">
          Refract Protocol — Parametric insurance on Stellar/Soroban · Built for DRIPS Wave Hackathon
        </span>
        <nav aria-label="Footer" className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
          {FOOTER_LINKS.map((link) => {
            const external = link.href.startsWith("http");
            const className = "text-xs text-pm-text/40 transition-colors hover:text-pm-text/70";
            return external ? (
              <a
                key={link.label}
                href={link.href}
                target="_blank"
                rel="noopener noreferrer"
                className={className}
              >
                {link.label}
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            ) : (
              <Link key={link.label} href={link.href} className={className}>
                {link.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </footer>
  );
}
