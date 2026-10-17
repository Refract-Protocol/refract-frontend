import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

describe('Realtime architecture & operational runbook docs (#222)', () => {
  const repoRoot = process.cwd()
  const archPath = path.join(repoRoot, 'docs', 'realtime-architecture.md')
  const runbookPath = path.join(repoRoot, 'docs', 'realtime-runbook.md')

  it('includes both architecture and operational runbook documents with required sections', () => {
    expect(fs.existsSync(archPath)).toBe(true)
    expect(fs.existsSync(runbookPath)).toBe(true)

    const archContent = fs.readFileSync(archPath, 'utf8')
    const runbookContent = fs.readFileSync(runbookPath, 'utf8')

    expect(archContent).toContain('Topic & Message Contract')
    expect(archContent).toContain('Connection State Machine')
    expect(archContent).toContain('Feature Flag Matrix')
    expect(archContent).toContain('realtimeEnabled')

    expect(runbookContent).toContain('Diagnosing "Data Stopped Updating"')
    expect(runbookContent).toContain('Disabling a Misbehaving Topic via Flags')
  })

  it('references valid repository paths that exist in the workspace', () => {
    const referencedPaths = [
      'src/lib/realtime/client.ts',
      'src/hooks/useOracleStatus.ts',
      'src/hooks/useRecentClaims.ts',
      'src/hooks/usePoolStats.ts',
      'src/hooks/useNotifications.ts',
      'src/lib/api/client.ts',
      'public/flags.json',
    ]

    for (const relPath of referencedPaths) {
      const fullPath = path.join(repoRoot, relPath)
      expect(fs.existsSync(fullPath), `Expected ${relPath} to exist`).toBe(true)
    }
  })
})
