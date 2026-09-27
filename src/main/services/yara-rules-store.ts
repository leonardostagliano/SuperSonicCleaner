import { readFileSync, existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'

interface YaraRulesMetadata {
  version: string
  updatedAt: string
  rulesCount: number
  sha256: string
}

// ─── Paths ───────────────────────────────────────────────────

let _dataDir: string | null = null

function getDataDir(): string {
  if (!_dataDir) {
    _dataDir = app.isPackaged ? app.getPath('userData') : join(app.getPath('userData'), 'Kudu-Dev')
  }
  return _dataDir
}

function getCachedRulesDir(): string {
  return join(getDataDir(), 'yara-rules')
}

function getMetadataPath(): string {
  return join(getCachedRulesDir(), 'metadata.json')
}

/** List .yar files in a directory. */
function listYarFiles(dir: string): string[] {
  try {
    if (!existsSync(dir)) return []
    return readdirSync(dir)
      .filter((f) => f.endsWith('.yar'))
      .sort()
      .map((f) => join(dir, f))
  } catch {
    return []
  }
}

// ─── Cached rule files (preserved local files) ──

/** Get paths to cached YARA rule files. */
export function getCachedRulePaths(): string[] {
  return listYarFiles(getCachedRulesDir())
}

/**
 * Get all YARA rule file paths.
 * Existing rule files remain available without contacting a remote service.
 */
export function getAllRulePaths(): string[] {
  return getCachedRulePaths()
}

export function getRulesMetadata(): YaraRulesMetadata | null {
  try {
    const path = getMetadataPath()
    if (!existsSync(path)) return null
    const raw = readFileSync(path, 'utf-8')
    const parsed = JSON.parse(raw)
    if (!validateMetadata(parsed)) return null
    return parsed as YaraRulesMetadata
  } catch {
    return null
  }
}

function validateMetadata(raw: unknown): boolean {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return false
  const obj = raw as Record<string, unknown>
  return (
    typeof obj.version === 'string' &&
    obj.version.length > 0 &&
    obj.version.length <= 100 &&
    typeof obj.updatedAt === 'string' &&
    obj.updatedAt.length > 0 &&
    obj.updatedAt.length <= 100 &&
    typeof obj.rulesCount === 'number' &&
    obj.rulesCount >= 0 &&
    typeof obj.sha256 === 'string' &&
    obj.sha256.length > 0 &&
    obj.sha256.length <= 128
  )
}
