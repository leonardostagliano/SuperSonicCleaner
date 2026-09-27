import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

const state = vi.hoisted(() => ({ dir: '' }))
vi.mock('electron', () => ({ app: { isPackaged: true, getPath: () => state.dir } }))

beforeEach(async () => {
  vi.resetModules()
  state.dir = await mkdtemp(join(tmpdir(), 'kudu-local-rules-'))
  vi.stubGlobal('fetch', vi.fn())
})
afterEach(async () => {
  vi.unstubAllGlobals()
  await rm(state.dir, { recursive: true, force: true })
})

describe('local YARA rules', () => {
  it('reports no signature coverage for a fresh profile without contacting a service', async () => {
    const rules = await import('./yara-rules-store')
    expect(rules.getAllRulePaths()).toEqual([])
    expect(rules.getRulesMetadata()).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('preserves and loads existing local rules and metadata', async () => {
    const dir = join(state.dir, 'yara-rules')
    await mkdir(dir)
    const metadata = {
      version: 'saved-v1',
      updatedAt: '2026-09-20',
      rulesCount: 2,
      sha256: 'old-hash'
    }
    await writeFile(join(dir, 'z.yar'), 'rule Z { condition: true }')
    await writeFile(join(dir, 'a.yar'), 'rule A { condition: true }')
    await writeFile(join(dir, 'notes.txt'), 'keep this file')
    await writeFile(join(dir, 'metadata.json'), JSON.stringify(metadata))
    const rules = await import('./yara-rules-store')
    expect(rules.getAllRulePaths()).toEqual([join(dir, 'a.yar'), join(dir, 'z.yar')])
    expect(rules.getRulesMetadata()).toEqual(metadata)
    expect(await readFile(join(dir, 'z.yar'), 'utf8')).toBe('rule Z { condition: true }')
    expect(await readFile(join(dir, 'notes.txt'), 'utf8')).toBe('keep this file')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('ignores malformed metadata while keeping valid rule paths available', async () => {
    const dir = join(state.dir, 'yara-rules')
    await mkdir(dir)
    await writeFile(join(dir, 'a.yar'), 'rule A { condition: true }')
    await writeFile(join(dir, 'metadata.json'), '{"version":false}')
    const rules = await import('./yara-rules-store')
    expect(rules.getRulesMetadata()).toBeNull()
    expect(rules.getCachedRulePaths()).toEqual([join(dir, 'a.yar')])
  })
})
