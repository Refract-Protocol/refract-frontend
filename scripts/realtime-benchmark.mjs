import { chromium } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";

const origin = process.env.REALTIME_BENCHMARK_URL ?? "http://127.0.0.1:3000";
const baseline = JSON.parse(await readFile(new URL("../reports/realtime-benchmark-baseline.json", import.meta.url), "utf8"));
const routes = ["/", "/cover", "/provide"];
const runs = Number(process.env.REALTIME_BENCHMARK_RUNS ?? 5);
const browser = await chromium.launch({ headless: true });
const samples = { disconnected: [], streaming: [] };
for (let index = 0; index < runs; index += 1) {
  for (const scenario of ["disconnected", "streaming"]) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.addInitScript(() => {
      window.__realtimeVitals = { longTasks: [], interactions: [] };
      try {
        new PerformanceObserver((list) => window.__realtimeVitals.longTasks.push(...list.getEntries().map((entry) => entry.duration)))
          .observe({ type: "longtask", buffered: true });
        new PerformanceObserver((list) => window.__realtimeVitals.interactions.push(...list.getEntries().map((entry) => entry.duration)))
          .observe({ type: "event", buffered: true, durationThreshold: 16 });
      } catch { /* event timing is not supported by every browser build */ }
    });
    await page.routeWebSocket("**/ws", (socket) => {
      if (scenario === "disconnected") { socket.close(); return; }
      let push = 0;
      const timer = setInterval(() => {
        push += 1;
        socket.send(JSON.stringify({ topic: "oracle_update", payload: [
          { coverageType: "StablecoinDepeg", type: "oracle_update", value: 1 + push / 100000, threshold: 0.95, severity: "low", message: "benchmark" },
        ] }));
        if (push >= 100) clearInterval(timer);
      }, 40);
    });
    for (const route of routes) {
      await page.goto(`${origin}${route}`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(250);
      await page.locator("body").click({ position: { x: 10, y: 10 } }).catch(() => undefined);
    }
    await page.waitForTimeout(4200);
    const result = await page.evaluate(() => ({
      profile: window.__REFRACT_REALTIME_PROFILE__ ?? {},
      longTasks: window.__realtimeVitals.longTasks,
      interactions: window.__realtimeVitals.interactions,
    }));
    samples[scenario].push(result);
    await context.close();
  }
}
await browser.close();
const median = (values) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;
const measure = (scenarioSamples) => {
  const commitDurations = scenarioSamples.flatMap((sample) => Object.values(sample.profile).flatMap((item) => item.durations ?? []));
  const longTasks = scenarioSamples.flatMap((sample) => sample.longTasks);
  const interactions = scenarioSamples.flatMap((sample) => sample.interactions);
  return {
    medianCommitDurationMs: median(commitDurations),
    p95CommitDurationMs: commitDurations.sort((a, b) => a - b)[Math.floor(commitDurations.length * 0.95)] ?? 0,
    medianCommitsPerTopic: Object.fromEntries(["oracle_update", "claim_settlement", "pool_stats"].map((topic) => [topic, median(scenarioSamples.map((sample) => sample.profile[topic]?.commits ?? 0))])),
    longTaskCount: longTasks.length,
    medianLongTaskDurationMs: median(longTasks),
    p98InteractionDurationMs: interactions.sort((a, b) => a - b)[Math.floor(interactions.length * 0.98)] ?? 0,
  };
};
const disconnected = measure(samples.disconnected);
const streaming = measure(samples.streaming);
const report = {
  generatedAt: new Date().toISOString(), runs, routes,
  scenarios: { disconnected, streaming },
  budget: baseline.budgets,
};
await writeFile("reports/realtime-benchmark.json", `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (streaming.medianCommitDurationMs > report.budget.medianCommitDurationMs || streaming.p95CommitDurationMs > report.budget.p95CommitDurationMs || streaming.longTaskCount > report.budget.longTaskCount || streaming.p98InteractionDurationMs > report.budget.p98InteractionDurationMs) process.exitCode = 1;
