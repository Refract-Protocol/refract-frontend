export type ConformanceViolationRuleId =
  | 'no-direct-transport-construction'
  | 'no-deep-realtime-import'
  | 'no-unscoped-realtime-subscribe'
  | 'missing-ignore-justification'

export interface ConformanceViolation {
  ruleId: ConformanceViolationRuleId
  line: number
  message: string
}

export interface ConformanceCheckResult {
  filePath: string
  valid: boolean
  violations: ConformanceViolation[]
}

/**
 * AST selector definitions suitable for wiring into `.eslintrc.json` `no-restricted-syntax`.
 */
export const REALTIME_ESLINT_AST_SELECTORS = [
  {
    selector: "NewExpression[callee.name='WebSocket']",
    message:
      'Do not construct WebSocket directly outside src/lib/realtime/. Use the shared realtime client or useRealtimeTopic hook.',
  },
  {
    selector: "NewExpression[callee.name='EventSource']",
    message:
      'Do not construct EventSource directly outside src/lib/realtime/. Use the shared realtime client or useRealtimeTopic hook.',
  },
] as const

const EXEMPT_PATH_PATTERNS = [
  /(?:^|\/)src\/lib\/realtime\//,
  /\.(?:test|spec)\.[jt]sx?$/,
  /(?:^|\/)(?:__tests__|e2e|mocks|scripts)\//,
]

const DIRECT_TRANSPORT_REGEX = /\bnew\s+(?:window\.|globalThis\.)?(WebSocket|EventSource)\s*\(/
const DEEP_IMPORT_REGEX =
  /^\s*import\s+(?!type\b)[\s\S]*?from\s+['"](?:@\/lib\/realtime\/|(?:(?:\.\.\/)+)lib\/realtime\/)(?!index['"])([^'"]+)['"]/
const BARE_SUBSCRIBE_REGEX = /\brealtimeClient\.subscribe\s*\(/
const IGNORE_DIRECTIVE_REGEX = /\/\/\s*realtime-lint-ignore(?::\s*(.*))?$/

export function isExemptRealtimePath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/').trim()
  return EXEMPT_PATH_PATTERNS.some((pattern) => pattern.test(normalized))
}

/**
 * Static conformance analyzer enforcing realtime module usage conventions across
 * source files, with support for justified `// realtime-lint-ignore: <reason>` comments.
 */
export function lintRealtimeSourceFile(
  filePath: string,
  sourceCode: string,
): ConformanceCheckResult {
  const normalizedPath = filePath.replace(/\\/g, '/').trim()
  if (isExemptRealtimePath(normalizedPath)) {
    return {
      filePath: normalizedPath,
      valid: true,
      violations: [],
    }
  }

  const lines = sourceCode.split(/\r?\n/)
  const violations: ConformanceViolation[] = []
  let insideEffectHookDepth = 0

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    const prevLine = i > 0 ? lines[i - 1] : ''
    const lineNumber = i + 1

    // Track whether we are inside useEffect / useLayoutEffect
    if (/\buse(?:Layout)?Effect\s*\(/.test(line)) {
      insideEffectHookDepth += 1
    }

    // Check ignore directive on current or immediately preceding line
    const ignoreMatch =
      IGNORE_DIRECTIVE_REGEX.exec(line) ??
      IGNORE_DIRECTIVE_REGEX.exec(prevLine)

    if (ignoreMatch) {
      const justification = (ignoreMatch[1] ?? '').trim()
      if (!justification) {
        violations.push({
          ruleId: 'missing-ignore-justification',
          line: lineNumber,
          message:
            'realtime-lint-ignore directive requires a non-empty justification after the colon (e.g. // realtime-lint-ignore: legacy migration).',
        })
      } else {
        continue
      }
    }

    // 1. Direct WebSocket / EventSource construction
    const transportMatch = DIRECT_TRANSPORT_REGEX.exec(line)
    if (transportMatch) {
      violations.push({
        ruleId: 'no-direct-transport-construction',
        line: lineNumber,
        message: `Direct construction of "new ${transportMatch[1]}(...)" is forbidden outside src/lib/realtime/. Use the shared realtime layer.`,
      })
    }

    // 2. Non-type deep import into src/lib/realtime/*
    const deepMatch = DEEP_IMPORT_REGEX.exec(line)
    if (deepMatch) {
      violations.push({
        ruleId: 'no-deep-realtime-import',
        line: lineNumber,
        message: `Deep import into "src/lib/realtime/${deepMatch[1]}" is forbidden. Import from "@/lib/realtime" instead.`,
      })
    }

    // 3. Direct realtimeClient.subscribe outside a React effect in components
    if (
      BARE_SUBSCRIBE_REGEX.test(line) &&
      insideEffectHookDepth === 0 &&
      !normalizedPath.includes('/src/hooks/')
    ) {
      violations.push({
        ruleId: 'no-unscoped-realtime-subscribe',
        line: lineNumber,
        message:
          'Calling realtimeClient.subscribe() outside a React effect or custom hook leaks subscriptions. Use useRealtimeTopic() instead.',
      })
    }

    if (insideEffectHookDepth > 0 && /^\s*\}\s*,\s*\[/.test(line)) {
      insideEffectHookDepth = Math.max(0, insideEffectHookDepth - 1)
    }
  }

  return {
    filePath: normalizedPath,
    valid: violations.length === 0,
    violations,
  }
}
