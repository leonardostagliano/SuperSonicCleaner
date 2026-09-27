import { randomBytes } from 'node:crypto'
import { createServer, type ServerResponse } from 'node:http'
import type { AiAnalysisRequest } from '../../shared/ai-analysis'
import type { PerformanceAiRequest } from '../../shared/performance-ai'
import {
  parsePerformanceAiResult,
  performanceAiInstructions,
  performanceAiResponseSchema,
  validatePerformanceAiRequest
} from './performance-ai-policy'
import {
  aiInstructions,
  aiResponseSchema,
  parseAiResult,
  validateAiMetadata
} from './ai-metadata-policy'

export type InferenceRequest = AiAnalysisRequest | PerformanceAiRequest
const validateRequest = (request: InferenceRequest): InferenceRequest =>
  request.source === 'performance'
    ? validatePerformanceAiRequest(request)
    : validateAiMetadata(request)
export const inferenceResponseSchema = (request: InferenceRequest): Record<string, unknown> =>
  request.source === 'performance'
    ? performanceAiResponseSchema(request)
    : aiResponseSchema(request)

// This is an inference boundary, not a generic proxy. Never use a URL supplied by
// the renderer, CLI request, user config, redirect or model response.
const CODEX_RESPONSES_URL = 'https://chatgpt.com/backend-api/codex/responses'
const MAX_RESPONSE_BYTES = 1_048_576
const SAFE_EVENTS = new Set([
  'response.created',
  'response.in_progress',
  'response.completed',
  'response.output_item.added',
  'response.output_item.done',
  'response.content_part.added',
  'response.content_part.done',
  'response.output_text.delta',
  'response.output_text.done',
  'response.reasoning_summary_part.added',
  'response.reasoning_summary_part.done',
  'response.reasoning_summary_text.delta',
  'response.reasoning_summary_text.done',
  'response.reasoning_text.delta',
  'response.reasoning_text.done'
])

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('invalid-response')
  return value as Record<string, unknown>
}

function safeItem(value: unknown): Record<string, unknown> {
  const item = object(value)
  if (item.type !== 'message' && item.type !== 'reasoning') throw new Error('tools-blocked')
  if (item.type === 'message') {
    if (item.role !== 'assistant' || !Array.isArray(item.content))
      throw new Error('invalid-response')
    if (item.phase != null && item.phase !== 'commentary' && item.phase !== 'final_answer') {
      throw new Error('invalid-response')
    }
    for (const content of item.content) {
      if (object(content).type !== 'output_text') throw new Error('invalid-response')
    }
  }
  return item
}

/** Validate the COMPLETE response before Codex can receive even the first event. */
export function validateMetadataSse(sse: string, request: InferenceRequest): string {
  let result: string | null = null
  const completedItems: Record<string, unknown>[] = []
  for (const frame of sse.replace(/\r\n/g, '\n').split('\n\n')) {
    const data = frame
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n')
    if (!data || data === '[DONE]') continue
    const event = object(JSON.parse(data))
    if (typeof event.type !== 'string' || !SAFE_EVENTS.has(event.type))
      throw new Error('tools-blocked')
    if (event.item !== undefined) {
      const item = safeItem(event.item)
      if (event.type === 'response.output_item.done') completedItems.push(item)
    }
    if (event.part !== undefined) {
      const part = object(event.part)
      if (
        part.type !== 'output_text' &&
        part.type !== 'summary_text' &&
        part.type !== 'reasoning_text'
      ) {
        throw new Error('tools-blocked')
      }
    }
    if (event.response !== undefined) {
      const response = object(event.response)
      if (Array.isArray(response.output)) response.output.forEach(safeItem)
      if (event.type === 'response.completed') {
        if (response.status !== 'completed' || !Array.isArray(response.output) || result !== null) {
          throw new Error('invalid-response')
        }
        // Codex's MessagePhase grammar distinguishes progress commentary from the terminal
        // answer. Legacy providers can omit phase; use their last message, never concatenate
        // separate messages. Every output above remains validated, including ignored commentary.
        // The Codex backend can emit completed.output=[] after delivering the complete items
        // in output_item.done. Only those terminal items qualify; added items and deltas never do.
        const output = response.output.length > 0 ? response.output.map(safeItem) : completedItems
        const messages = output
          .map(safeItem)
          .filter((item) => item.type === 'message')
          .reverse()
        const finalMessage =
          messages.find((item) => item.phase === 'final_answer') ||
          messages.find((item) => item.phase == null)
        if (!finalMessage) throw new Error('invalid-response')
        result = (finalMessage.content as unknown[])
          .map((part) => {
            const text = object(part).text
            if (typeof text !== 'string') throw new Error('invalid-response')
            return text
          })
          .join('')
      }
    }
  }
  if (result === null) throw new Error('invalid-response')
  if (request.source === 'performance') parsePerformanceAiResult(result, request)
  else parseAiResult(result, request)
  return result
}

export function metadataInferenceBody(
  request: InferenceRequest,
  model: string,
  italian: boolean
): object {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(model)) throw new Error('unavailable')
  return {
    model,
    instructions:
      request.source === 'performance'
        ? performanceAiInstructions(italian)
        : aiInstructions(italian),
    input: [
      {
        role: 'user',
        content: [{ type: 'input_text', text: JSON.stringify(validateRequest(request)) }]
      }
    ],
    tools: [],
    tool_choice: 'none',
    parallel_tool_calls: false,
    store: false,
    stream: true,
    reasoning: { effort: 'low' },
    text: {
      format: {
        type: 'json_schema',
        name:
          request.source === 'performance'
            ? 'supersonic_performance_advice'
            : 'kudu_metadata_advice',
        strict: true,
        schema: inferenceResponseSchema(request)
      }
    }
  }
}

export async function createMetadataInferenceProxy(
  input: InferenceRequest,
  options: { model: string; italian: boolean; signal: AbortSignal },
  fetcher: typeof fetch = fetch
): Promise<{ baseUrl: string; close: () => Promise<void>; getResult: () => string | null }> {
  const request = validateRequest(input)
  // Serialize once from the trusted whitelist, BEFORE accepting a CLI request.
  const body = JSON.stringify(metadataInferenceBody(request, options.model, options.italian))
  const route = `/${randomBytes(32).toString('hex')}`
  const abort = new AbortController()
  const onAbort = (): void => {
    abort.abort()
  }
  options.signal.addEventListener('abort', onAbort, { once: true })
  if (options.signal.aborted) abort.abort()
  let result: string | null = null
  let used = false
  const fail = (response: ServerResponse): void => {
    if (response.destroyed) return
    response.writeHead(502, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ error: { message: 'analysis-failed', type: 'server_error' } }))
  }
  const server = createServer(async (incoming, outgoing) => {
    try {
      if (
        used ||
        abort.signal.aborted ||
        incoming.method !== 'POST' ||
        incoming.url !== `${route}/responses` ||
        incoming.headers.origin !== undefined
      ) {
        incoming.resume()
        outgoing.writeHead(403).end()
        return
      }
      const authorization = incoming.headers.authorization
      const accountId = incoming.headers['chatgpt-account-id']
      if (
        !authorization?.startsWith('Bearer ') ||
        authorization.length > 16384 ||
        (accountId !== undefined && (typeof accountId !== 'string' || accountId.length > 256))
      ) {
        incoming.resume()
        outgoing.writeHead(401).end()
        return
      }
      used = true
      let bytes = 0
      // Deliberately discard ALL CLI body fields, including context, tools,
      // previous_response_id, metadata, user instructions and any tool outputs.
      for await (const chunk of incoming) {
        bytes += Buffer.byteLength(chunk)
        if (bytes > 2_097_152) throw new Error('request-too-large')
      }
      const headers: Record<string, string> = {
        Authorization: authorization,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream'
      }
      if (typeof accountId === 'string') headers['ChatGPT-Account-Id'] = accountId
      const upstream = await fetcher(CODEX_RESPONSES_URL, {
        method: 'POST',
        headers,
        body,
        redirect: 'error',
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(120_000)])
      })
      if (!upstream.ok || !upstream.body) throw new Error('analysis-failed')
      const reader = upstream.body.getReader()
      const chunks: Uint8Array[] = []
      let size = 0
      try {
        while (true) {
          const next = await reader.read()
          if (next.done) break
          size += next.value.byteLength
          if (size > MAX_RESPONSE_BYTES) throw new Error('invalid-response')
          chunks.push(next.value)
        }
      } finally {
        await reader.cancel().catch(() => {})
      }
      const sse = Buffer.concat(chunks).toString('utf8')
      result = validateMetadataSse(sse, request)
      if (abort.signal.aborted || outgoing.destroyed) return
      outgoing.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' })
      outgoing.end(sse)
    } catch {
      // Never expose raw upstream errors, prompts, auth headers or CLI data.
      fail(outgoing)
    }
  })
  server.requestTimeout = 150_000
  server.headersTimeout = 10_000
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject)
      resolve()
    })
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('unavailable')
  return {
    baseUrl: `http://127.0.0.1:${address.port}${route}`,
    getResult: () => result,
    close: async () => {
      abort.abort()
      options.signal.removeEventListener('abort', onAbort)
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
}
