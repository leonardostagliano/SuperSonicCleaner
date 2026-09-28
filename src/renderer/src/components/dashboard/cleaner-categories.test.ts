import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { CleanerType } from '@shared/enums'
import { ANALYSIS_CATEGORIES } from './cleaner-categories'

/** `{ type: CleanerType.X, labelKey: 'y' }` pairs of CleanerPage's `categories`, in order. */
function cleanerPageCategories(): { type: string; labelKey: string }[] {
  const source = fs.readFileSync(path.resolve(__dirname, '../../pages/CleanerPage.tsx'), 'utf8')
  const list = /const categories: CategoryDef\[\] = \[([\s\S]*?)\n\]/.exec(source)?.[1] ?? ''
  return [...list.matchAll(/type: CleanerType\.(\w+),\s*labelKey: '(\w+)'/g)].map(
    ([, member, labelKey]) => ({
      type: CleanerType[member as keyof typeof CleanerType],
      labelKey
    })
  )
}

describe('ANALYSIS_CATEGORIES', () => {
  it("matches the Cleaner page's own list, so Home starts the same analysis", () => {
    const page = cleanerPageCategories()
    expect(page.length).toBeGreaterThan(0)
    expect(ANALYSIS_CATEGORIES).toEqual(page)
  })
})
