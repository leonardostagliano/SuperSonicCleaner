import { describe, expect, it } from 'vitest'
import { validateAiMetadata, parseAiResult } from './ai-metadata-policy'
import type { AiAnalysisRequest } from '../../shared/ai-analysis'

const id = '113725ef-52ec-499e-b40a-35f433aef1bc'
const request: AiAnalysisRequest = {
  source: 'large-files',
  items: [{ id, fileType: 'document', sizeBytes: 1024, modifiedAgeDays: 30, accessedAgeDays: null }]
}

describe('AI metadata boundary', () => {
  it('constructs a detached whitelist containing only pseudonymous metadata', () => {
    const result = validateAiMetadata(request)
    expect(result).toEqual(request)
    expect(result).not.toBe(request)
    expect(result.items[0]).not.toBe(request.items[0])
  })

  it.each(['path', 'name', 'content', 'hash', 'extension', 'category', 'prompt'])(
    'rejects unexpected %s even on a valid metadata item',
    (key) => {
      expect(() =>
        validateAiMetadata({
          ...request,
          items: [{ ...request.items[0], [key]: 'private information' }]
        })
      ).toThrow('invalid-metadata')
    }
  )

  it.each([
    { id: 'C:\\Users\\private.txt' },
    { fileType: 'secret.txt' },
    { sizeBytes: Infinity },
    { sizeBytes: -1 },
    { modifiedAgeDays: 'yesterday' },
    { accessedAgeDays: -1 },
    { accessedAgeDays: 36501 },
    { duplicateGroupId: 'file-hash' }
  ])('rejects non-allowlisted values %#', (extra) => {
    expect(() =>
      validateAiMetadata({ ...request, items: [{ ...request.items[0], ...extra }] })
    ).toThrow('invalid-metadata')
  })

  it('rejects duplicate IDs and oversized requests', () => {
    expect(() =>
      validateAiMetadata({ ...request, items: [request.items[0], request.items[0]] })
    ).toThrow('invalid-metadata')
    expect(() =>
      validateAiMetadata({ ...request, items: Array(101).fill(request.items[0]) })
    ).toThrow('invalid-metadata')
  })

  it('only resolves known IDs, and errors never reflect invalid input', () => {
    const valid = {
      summary: 'Review manually.',
      recommendations: [{ fileId: id, priority: 'low', reason: 'Large document.' }]
    }
    expect(parseAiResult(JSON.stringify(valid), request)).toEqual(valid)
    expect(() =>
      parseAiResult(
        JSON.stringify({
          ...valid,
          recommendations: [{ ...valid.recommendations[0], fileId: 'private-path' }]
        }),
        request
      )
    ).toThrow(/^invalid-response$/)
    expect(() => parseAiResult('private error response', request)).toThrow(/^invalid-response$/)
  })
})
