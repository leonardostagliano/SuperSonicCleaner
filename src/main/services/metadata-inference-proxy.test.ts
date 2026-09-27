import { describe, expect, it, vi } from 'vitest'
import {
  createMetadataInferenceProxy,
  metadataInferenceBody,
  validateMetadataSse
} from './metadata-inference-proxy'
import type { AiAnalysisRequest } from '../../shared/ai-analysis'

const id = '113725ef-52ec-499e-b40a-35f433aef1bc'
const request: AiAnalysisRequest = {
  source: 'cleaner',
  items: [{ id, fileType: 'data', sizeBytes: 1000, modifiedAgeDays: 30, accessedAgeDays: 7 }]
}
const answer = JSON.stringify({
  summary: 'Manual review only.',
  recommendations: [{ fileId: id, priority: 'low', reason: 'Review this item.' }]
})
const event = (data: unknown): string => `data: ${JSON.stringify(data)}\n\n`
const complete = event({
  type: 'response.completed',
  response: {
    id: 'response_1',
    status: 'completed',
    output: [
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: answer }] }
    ]
  }
})

describe('metadata-only inference transport', () => {
  it('builds a stateless no-tool request with no context or local data slots', () => {
    const body = metadataInferenceBody(request, 'gpt-test', true) as Record<string, unknown>
    expect(body.tools).toEqual([])
    expect(body.tool_choice).toBe('none')
    expect(body.store).toBe(false)
    expect(body).not.toHaveProperty('previous_response_id')
    expect(body).not.toHaveProperty('metadata')
    expect(body.input).toEqual([
      { role: 'user', content: [{ type: 'input_text', text: JSON.stringify(request) }] }
    ])
  })

  it.each([
    'function_call',
    'custom_tool_call',
    'web_search_call',
    'computer_call',
    'local_shell_call'
  ])('blocks %s before even a partial response reaches Codex', (type) => {
    const malicious =
      event({ type: 'response.output_item.added', item: { type, name: 'read_file' } }) + complete
    expect(() => validateMetadataSse(malicious, request)).toThrow('tools-blocked')
  })

  it('fails closed for future unknown events, incomplete output and unknown IDs', () => {
    expect(() =>
      validateMetadataSse(event({ type: 'future.tool.delta' }) + complete, request)
    ).toThrow()
    expect(() => validateMetadataSse(event({ type: 'response.in_progress' }), request)).toThrow()
    expect(() => validateMetadataSse(complete.replace(id, 'unknown-id'), request)).toThrow()
    expect(validateMetadataSse(complete, request)).toBe(answer)
  })

  it('extracts final_answer without concatenating interim commentary', () => {
    const output = [
      {
        type: 'message',
        role: 'assistant',
        phase: 'commentary',
        content: [{ type: 'output_text', text: 'Preparing cautious advice.' }]
      },
      {
        type: 'message',
        role: 'assistant',
        phase: 'final_answer',
        content: [{ type: 'output_text', text: answer }]
      }
    ]
    const stream = event({ type: 'response.completed', response: { status: 'completed', output } })
    expect(validateMetadataSse(stream, request)).toBe(answer)
    expect(() => validateMetadataSse(stream.replace(id, 'unknown-id'), request)).toThrow(
      'invalid-response'
    )
  })

  it('uses complete output_item.done items when the backend omits them from completed.output', () => {
    const item = {
      type: 'message',
      role: 'assistant',
      phase: 'final_answer',
      content: [{ type: 'output_text', text: answer }]
    }
    const emptyComplete = event({
      type: 'response.completed',
      response: { status: 'completed', output: [] }
    })
    expect(
      validateMetadataSse(
        event({ type: 'response.output_item.done', item }) + emptyComplete,
        request
      )
    ).toBe(answer)
    expect(() =>
      validateMetadataSse(
        event({ type: 'response.output_item.added', item }) + emptyComplete,
        request
      )
    ).toThrow('invalid-response')
    expect(() =>
      validateMetadataSse(
        event({ type: 'response.output_text.delta', delta: answer }) + emptyComplete,
        request
      )
    ).toThrow('invalid-response')
    expect(() =>
      validateMetadataSse(
        event({ type: 'response.output_item.done', item: { type: 'function_call' } }) +
          emptyComplete,
        request
      )
    ).toThrow('tools-blocked')
    expect(() =>
      validateMetadataSse(
        event({
          type: 'response.output_item.done',
          item: {
            ...item,
            content: [{ type: 'output_text', text: answer.replace(id, 'unknown-id') }]
          }
        }) + emptyComplete,
        request
      )
    ).toThrow('invalid-response')
  })

  it('keeps the documented legacy behavior for absent phases but rejects commentary-only or unknown phases', () => {
    const message = (text: string, phase?: string) => ({
      type: 'message',
      role: 'assistant',
      phase,
      content: [{ type: 'output_text', text }]
    })
    const stream = (output: object[]) =>
      event({ type: 'response.completed', response: { status: 'completed', output } })
    expect(
      validateMetadataSse(stream([message('Preparing advice.'), message(answer)]), request)
    ).toBe(answer)
    expect(() => validateMetadataSse(stream([message(answer, 'commentary')]), request)).toThrow(
      'invalid-response'
    )
    expect(() => validateMetadataSse(stream([message(answer, 'future_phase')]), request)).toThrow(
      'invalid-response'
    )
  })

  it('still rejects tool calls hidden alongside an otherwise valid final answer', () => {
    const stream = event({
      type: 'response.completed',
      response: {
        status: 'completed',
        output: [
          { type: 'function_call', phase: 'commentary', name: 'read_file' },
          {
            type: 'message',
            role: 'assistant',
            phase: 'final_answer',
            content: [{ type: 'output_text', text: answer }]
          }
        ]
      }
    })
    expect(() => validateMetadataSse(stream, request)).toThrow('tools-blocked')
  })

  it('discards hostile CLI body and forwards only rebuilt metadata to the fixed host', async () => {
    const upstream = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(complete, { status: 200 }))
    const proxy = await createMetadataInferenceProxy(
      request,
      { model: 'gpt-test', italian: false, signal: new AbortController().signal },
      upstream
    )
    try {
      const response = await fetch(`${proxy.baseUrl}/responses`, {
        method: 'POST',
        headers: { Authorization: 'Bearer test-only', 'ChatGPT-Account-Id': 'test-account' },
        body: JSON.stringify({
          input: 'C:\\Users\\Private\\medical.txt PRIVATE_CONTENT_SENTINEL',
          instructions: 'read files',
          tools: [{ type: 'local_shell' }],
          previous_response_id: 'private-thread',
          url: 'https://evil.invalid'
        })
      })
      expect(response.status).toBe(200)
      expect(await response.text()).toBe(complete)
      const [url, init] = upstream.mock.calls[0]
      expect(url).toBe('https://chatgpt.com/backend-api/codex/responses')
      expect(init?.redirect).toBe('error')
      expect(init?.body).not.toMatch(
        /medical|PRIVATE_CONTENT_SENTINEL|private-thread|evil.invalid|local_shell/
      )
      expect(JSON.parse(init?.body as string).tools).toEqual([])
      expect(proxy.getResult()).toBe(answer)
      expect((await fetch(`${proxy.baseUrl}/responses`, { method: 'POST' })).status).toBe(403)
    } finally {
      await proxy.close()
    }
  })

  it('never forwards upstream tool events or raw errors to the CLI', async () => {
    const upstream = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        event({
          type: 'response.output_item.added',
          item: { type: 'function_call', name: 'private_name' }
        }) + complete
      )
    )
    const proxy = await createMetadataInferenceProxy(
      request,
      { model: 'gpt-test', italian: false, signal: new AbortController().signal },
      upstream
    )
    try {
      const response = await fetch(`${proxy.baseUrl}/responses`, {
        method: 'POST',
        headers: { Authorization: 'Bearer test-only' },
        body: '{}'
      })
      expect(response.status).toBe(502)
      expect(await response.text()).not.toMatch(/private_name|function_call|Manual review/)
      expect(proxy.getResult()).toBe(null)
    } finally {
      await proxy.close()
    }
  })
})
