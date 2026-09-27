import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const state = vi.hoisted(() => ({
  roots: new Set<string>(),
  active: 0,
  peak: 0
}))

vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>()
  return {
    ...actual,
    lstat: async (...args: Parameters<typeof actual.lstat>) => {
      if (state.roots.has(String(args[0]))) {
        state.active++
        state.peak = Math.max(state.peak, state.active)
        await new Promise((resolve) => setTimeout(resolve, 15))
        state.active--
      }
      return actual.lstat(...args)
    }
  }
})

vi.mock('./settings-store', () => ({
  getSettings: () => ({ cleaner: { skipRecentMinutes: 60 }, exclusions: [] })
}))

import { scanMultipleDirectories } from './file-utils'

let fixture: string

beforeEach(() => {
  fixture = mkdtempSync(join(tmpdir(), 'kudu-scan-concurrency-'))
  state.roots.clear()
  state.active = 0
  state.peak = 0
})

afterEach(() => rmSync(fixture, { recursive: true, force: true }))

it('scans independent roots concurrently while preserving their result order', async () => {
  const roots = Array.from({ length: 12 }, (_, index) => {
    const root = join(fixture, `root-${index}`)
    mkdirSync(root)
    const file = join(root, `file-${index}.bin`)
    writeFileSync(file, Buffer.alloc(index + 1))
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000)
    utimesSync(file, old, old)
    state.roots.add(root)
    return root
  })

  const result = await scanMultipleDirectories(roots, 'app', 'Synthetic')

  expect(state.peak).toBe(4)
  expect(result.items.map((item) => item.path)).toEqual(
    roots.map((root, index) => join(root, `file-${index}.bin`))
  )
  expect(result.totalSize).toBe(78)
})
