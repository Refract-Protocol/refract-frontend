import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  auditSource,
  hasUseClient,
  listSourceFiles,
  renderReport,
  runAudit,
} from "./audit-client-boundaries";

describe("hasUseClient", () => {
  it("detects the directive, allowing leading comments and either quote style", () => {
    expect(hasUseClient('"use client";\nexport const a = 1;')).toBe(true);
    expect(hasUseClient("'use client'\n")).toBe(true);
    expect(hasUseClient('/** doc */\n// note\n"use client";\n')).toBe(true);
  });
  it("ignores files without it or with it mid-file", () => {
    expect(hasUseClient("export const a = 1;")).toBe(false);
    expect(hasUseClient('import x from "y";\n"use client";')).toBe(false);
  });
});

describe("auditSource", () => {
  it("skips server files", () => expect(auditSource("src/app/a.tsx", "export {}")).toBeNull());

  it("classifies interactive files and top-level boundaries", () => {
    const a = auditSource(
      "src/app/page.tsx",
      '"use client";\nconst [x] = useState(0);\n<button onClick={() => x}/>\n<p/>\n'
    )!;
    expect(a).toMatchObject({ topLevel: true, verdict: "interactive", signals: 2, lines: 4 });
    expect(a.interactiveShare).toBe(0.5);
  });

  it("flags a client file with no interactivity as a server candidate", () => {
    const a = auditSource(
      "src/components/Static.tsx",
      '"use client";\nexport const S = () => <p>hi</p>;'
    )!;
    expect(a).toMatchObject({ topLevel: false, verdict: "candidate-for-server", signals: 0 });
  });

  it("counts browser APIs and handles empty files", () => {
    expect(auditSource("f.tsx", '"use client";\nwindow.scrollTo(0,0);')!.signals).toBe(1);
    expect(auditSource("f.tsx", '"use client";')!.interactiveShare).toBe(0);
  });
});

describe("filesystem + report", () => {
  const root = mkdtempSync(join(tmpdir(), "audit-"));
  mkdirSync(join(root, "src/app/x"), { recursive: true });
  mkdirSync(join(root, "src/components"), { recursive: true });
  writeFileSync(join(root, "src/app/x/page.tsx"), '"use client";\nconst a = useRef();');
  writeFileSync(join(root, "src/app/x/page.test.tsx"), '"use client";');
  writeFileSync(join(root, "src/app/server.tsx"), "export {}");
  writeFileSync(join(root, "src/components/Static.tsx"), '"use client";\nexport const S = 1;');

  it("walks only non-test tsx files", () => {
    expect(
      listSourceFiles(join(root, "src"))
        .map((f) => f.split("src/")[1])
        .sort()
    ).toEqual(["app/server.tsx", "app/x/page.tsx", "components/Static.tsx"]);
  });

  it("audits the tree and renders every section", () => {
    const audits = runAudit(root);
    expect(audits.map((a) => a.file)).toEqual(["src/app/x/page.tsx", "src/components/Static.tsx"]);
    const md = renderReport(audits);
    expect(md).toContain("2 client files; 1 are top-level");
    expect(md).toContain("candidate-for-server");
    expect(renderReport([])).toContain("None.");
    expect(renderReport(audits.filter((a) => a.topLevel))).toContain("None — every client file");
  });
});
