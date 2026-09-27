import { describe, expect, it } from 'vitest'
import { buildAiAnalysisRequest, classifyLocalFile, MAX_AI_ITEMS } from './ai-metadata'

describe('AI metadata adapter', () => {
  it('serializes only opaque IDs and bounded generic metadata', () => {
    const path = 'C:\\Users\\A Person\\Private Budget 2026.xlsx'
    const group = 'private-content-hash'
    const now = 1_800_000_000_000
    const { request, localPaths } = buildAiAnalysisRequest(
      'duplicates',
      [
        {
          path,
          size: 1200,
          lastModified: now - 40 * 86_400_000,
          lastAccessed: now - 8 * 86_400_000,
          duplicateGroupKey: group
        },
        { path: 'C:\\Backups\\copy.xlsx', size: 1200, duplicateGroupKey: group }
      ],
      now
    )

    expect(request.items).toHaveLength(2)
    expect(request.items[0]).toMatchObject({
      fileType: 'document',
      sizeBytes: 1200,
      modifiedAgeDays: 30,
      accessedAgeDays: 7
    })
    expect(request.items[0].duplicateGroupId).toBe(request.items[1].duplicateGroupId)
    expect(request.items[0].id).not.toBe(request.items[1].id)
    expect(localPaths.get(request.items[0].id)).toBe(path)
    const outgoing = JSON.stringify(request)
    expect(outgoing).not.toContain('Private Budget')
    expect(outgoing).not.toContain('Backups')
    expect(outgoing).not.toContain(group)
    expect(outgoing).not.toContain('.xlsx')
  })

  it('creates new IDs for each request and limits analysis to the largest items', () => {
    const candidates = Array.from({ length: MAX_AI_ITEMS + 2 }, (_, index) => ({
      path: `/private/file-${index}.bin`,
      size: index
    }))
    const first = buildAiAnalysisRequest('large-files', candidates)
    const second = buildAiAnalysisRequest('large-files', candidates)

    expect(first.request.items).toHaveLength(MAX_AI_ITEMS)
    expect(first.omitted).toBe(2)
    expect(first.localPaths.get(first.request.items[0].id)).toBe(
      `/private/file-${MAX_AI_ITEMS + 1}.bin`
    )
    expect(first.request.items[0].id).not.toBe(second.request.items[0].id)
  })

  it('maps unknown extensions to other without including the extension', () => {
    expect(classifyLocalFile('/private/notes.confidential')).toBe('other')
  })
})
