import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const BASELINE_PATH = resolve('reports/realtime-benchmark-baseline.json');
const REPORT_PATH = resolve('reports/realtime-benchmark.json');
const DEFAULT_MAX_REGRESSION = 0.1;

interface BenchmarkMeasurement {
  medianCommitMs: number;
  p95CommitMs: number;
  longTasks: number;
  p98EventMs: number;
}

interface BenchmarkReport {
  scenarios: Record<string, BenchmarkMeasurement>;
}

function parseMaxRegression(argv: string[]): number {
  const flag = '--max-regression';
  const index = argv.findIndex((arg) => arg === flag || arg.startsWith(`${flag}=`));
  if (index === -1) {
    return DEFAULT_MAX_REGRESSION;
  }

  const raw = argv[index].includes('=')
    ? argv[index].slice(flag.length + 1)
    : argv[index + 1];

  if (raw === undefined) {
    throw new Error(`${flag} requires a value (e.g. ${flag}=0.1 or ${flag}=10%)`);
  }

  const trimmed = raw.trim();
  const isPercent = trimmed.endsWith('%');
  const numeric = Number.parseFloat(isPercent ? trimmed.slice(0, -1) : trimmed);

  if (!Number.isFinite(numeric) || numeric < 0) {
    throw new Error(`Invalid ${flag} value: ${raw}`);
  }

  return isPercent ? numeric / 100 : numeric;
}

function exceedsBaseline(actual: number, baseline: number, margin: number): boolean {
  if (baseline <= 0) {
    return actual > 0;
  }
  return actual > baseline * (1 + margin);
}

async function main(): Promise<void> {
  const maxRegression = parseMaxRegression(process.argv.slice(2));

  const [baselineRaw, reportRaw] = await Promise.all([
    readFile(BASELINE_PATH, 'utf8'),
    readFile(REPORT_PATH, 'utf8'),
  ]);

  const baseline = JSON.parse(baselineRaw) as BenchmarkReport;
  const report = JSON.parse(reportRaw) as BenchmarkReport;

  const failures: string[] = [];

  for (const [scenario, expected] of Object.entries(baseline.scenarios)) {
    const actual = report.scenarios[scenario];
    if (!actual) {
      failures.push(`${scenario}: missing from benchmark report`);
      continue;
    }

    for (const metric of Object.keys(expected) as (keyof BenchmarkMeasurement)[]) {
      const baseValue = expected[metric];
      const actualValue = actual[metric];
      if (exceedsBaseline(actualValue, baseValue, maxRegression)) {
        const limit = baseValue * (1 + maxRegression);
        failures.push(
          `${scenario}.${metric}: ${actualValue} exceeds baseline ${baseValue} by more than ${(maxRegression * 100).toFixed(1)}% (limit ${limit.toFixed(2)})`,
        );
      }
    }
  }

  if (failures.length > 0) {
    console.error('Realtime decode benchmark exceeded the regression budget:');
    for (const failure of failures) {
      console.error(`  - ${failure}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(
    `Realtime decode benchmark within budget (max regression ${(maxRegression * 100).toFixed(1)}%).`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
