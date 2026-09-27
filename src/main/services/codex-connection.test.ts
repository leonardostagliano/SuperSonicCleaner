import { EventEmitter } from 'events'
import { PassThrough, Writable } from 'stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiAnalysisRequest } from '../../shared/ai-analysis'

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  execFile: vi.fn(),
  access: vi.fn(),
  readdir: vi.fn(),
  mkdtemp: vi.fn(),
  rm: vi.fn(),
  proxy: vi.fn(),
  proxyClose: vi.fn(),
  mode: 'success',
  sent: [] as Record<string, unknown>[],
  killed: 0
}))
vi.mock('child_process', () => ({ spawn: mocks.spawn, execFile: mocks.execFile }))
vi.mock('fs/promises', () => ({
  access: mocks.access,
  readdir: mocks.readdir,
  mkdtemp: mocks.mkdtemp,
  rm: mocks.rm
}))
vi.mock('./metadata-inference-proxy', () => ({ createMetadataInferenceProxy: mocks.proxy }))

import {
  analyzeMetadataWithCodex,
  analyzePerformanceWithCodex,
  codexConfigArgs,
  codexEnvironment,
  getCodexConnectionStatus,
  resolveCodexCommand,
  selectMetadataModel,
  verifyCodexConfiguration
} from './codex-connection'

const request: AiAnalysisRequest = {
  source: 'large-files',
  items: [
    {
      id: '7817e756-ad24-4860-b832-e1cda3023c43',
      fileType: 'video',
      sizeBytes: 10000,
      modifiedAgeDays: 365,
      accessedAgeDays: null
    }
  ]
}
const answer = JSON.stringify({ summary: 'Valuta con cautela.', recommendations: [] })

function configuration(args = codexConfigArgs('http://127.0.0.1:1234/secret')) {
  const features: Record<string, boolean> = {}
  for (const arg of args) {
    const match = /^features\.([^=]+)=(true|false)$/.exec(arg)
    if (match) features[match[1]] = match[2] === 'true'
  }
  const provider = args.find((arg) => arg.startsWith('model_providers=')) || ''
  const baseUrl = /base_url="([^" ]+)"/.exec(provider)?.[1]
  return {
    config: {
      features,
      mcp_servers: {},
      plugins: {},
      notify: [],
      model_provider: 'kudu_metadata',
      model_providers: {
        kudu_metadata: { base_url: baseUrl, requires_openai_auth: true, supports_websockets: false }
      },
      project_doc_max_bytes: 0,
      analytics: { enabled: false },
      otel: { exporter: 'none', metrics_exporter: 'none', trace_exporter: 'none' }
    }
  }
}

function processMock(_executable: string, args: string[]) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: PassThrough
    stderr: PassThrough
    stdin: Writable
    kill(): void
  }
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  const emit = (value: unknown) => child.stdout.write(JSON.stringify(value) + '\n')
  child.kill = () => {
    mocks.killed++
    child.emit('close', null)
  }
  child.stdin = new Writable({
    write(chunk, _encoding, done) {
      const message = JSON.parse(chunk.toString())
      if (message.method === 'initialized') {
        done()
        return
      }
      mocks.sent.push(message)
      queueMicrotask(() => {
        let result: unknown = {}
        if (message.method === 'config/read') {
          result = configuration(args)
          if (mocks.mode === 'integrations') {
            const config = (result as ReturnType<typeof configuration>).config
            config.mcp_servers = {
              example: { enabled: !args.includes('mcp_servers={"example"={enabled=false}}') }
            }
            config.plugins = {
              'example@local': {
                enabled: !args.includes('plugins={"example@local"={enabled=false}}')
              }
            }
          }
        }
        if (message.method === 'account/read')
          result = { account: mocks.mode === 'logged-out' ? null : { type: 'chatgpt' } }
        if (message.method === 'model/list')
          result = { data: [{ model: 'gpt-6-luna', hidden: false }] }
        if (message.method === 'thread/start') result = { thread: { id: 'thread-1' } }
        if (message.method === 'turn/start' && mocks.mode === 'server-request') {
          emit({ id: 'server-1', method: 'item/commandExecution/requestApproval', params: {} })
          return
        }
        if (message.method === 'turn/start' && mocks.mode === 'unknown-notification') {
          emit({ method: 'future/toolEvent', params: {} })
          return
        }
        if (message.method === 'turn/start' && mocks.mode === 'provider-error') {
          emit({ method: 'error', params: { error: { message: 'private diagnostic' } } })
          return
        }
        emit({ id: message.id, result })
        if (message.method === 'turn/start' && mocks.mode !== 'pending') {
          emit({ method: 'thread/settings/updated', params: { threadId: 'thread-1' } })
          if (mocks.mode === 'tool')
            emit({ method: 'item/started', params: { item: { type: 'commandExecution' } } })
          else {
            // The UTF-8 byte sequence is deliberately split across transport chunks.
            const text = Buffer.from(
              JSON.stringify({
                method: 'item/completed',
                params: { item: { type: 'agentMessage', text: 'perché' } }
              }) + '\n'
            )
            const split = text.indexOf(Buffer.from('é')) + 1
            child.stdout.write(text.subarray(0, split))
            child.stdout.write(text.subarray(split))
            emit({
              method: 'turn/completed',
              params: { threadId: 'thread-1', turn: { status: 'completed' } }
            })
          }
        }
      })
      done()
    }
  })
  return child
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.mode = 'success'
  mocks.sent = []
  mocks.killed = 0
  mocks.access.mockResolvedValue(undefined)
  mocks.readdir.mockResolvedValue(['0.157.1-x86_64-pc-windows-msvc'])
  mocks.mkdtemp.mockImplementation(async (prefix: string) => prefix + 'random')
  mocks.rm.mockResolvedValue(undefined)
  mocks.execFile.mockImplementation((_exe, _args, _opts, callback) =>
    callback(null, 'codex-cli 0.157.1\n')
  )
  mocks.spawn.mockImplementation(processMock)
  mocks.proxy.mockResolvedValue({
    baseUrl: 'http://127.0.0.1:1234/secret',
    close: mocks.proxyClose,
    getResult: () => answer
  })
})
afterEach(() => vi.unstubAllEnvs())

describe('Codex connection privacy boundary', () => {
  it('keeps the login home without copying auth or inheriting API keys, node hooks, or remote routing', () => {
    const env = codexEnvironment({
      CODEX_HOME: '/login',
      HOME: '/person',
      PATH: '/bin',
      OPENAI_API_KEY: 'secret',
      NODE_OPTIONS: '--require evil',
      OPENAI_BASE_URL: 'https://evil.test',
      HTTP_PROXY: 'https://evil.test',
      CUSTOM_SECRET: 'secret'
    })
    expect(env).toEqual({ CODEX_HOME: '/login', HOME: '/person', PATH: '/bin', RUST_LOG: 'off' })
  })
  it('permits only loopback HTTP provider URLs and resets inherited integrations', () => {
    for (const url of [
      'https://127.0.0.1:12/x',
      'http://evil.test:123/x',
      'http://127.0.0.1:12/x?remote=true'
    ]) {
      expect(() => codexConfigArgs(url)).toThrow('unsafe-configuration')
    }
    const args = codexConfigArgs('http://127.0.0.1:1234/secret')
    expect(args).toContain('mcp_servers={}')
    expect(args).toContain('plugins={}')
    expect(args).toContain('features.hooks=false')
    expect(args).toContain('features.enable_request_compression=false')
    expect(args.join(' ')).toContain('supports_websockets=false')
  })
  it('fails closed when effective integrations, telemetry, or provider routing differ', () => {
    const value = configuration()
    expect(() => verifyCodexConfiguration(value, 'http://127.0.0.1:1234/secret')).not.toThrow()
    value.config.features.hooks = true
    expect(() => verifyCodexConfiguration(value, 'http://127.0.0.1:1234/secret')).toThrow(
      'unsafe-configuration'
    )
    value.config.features.hooks = false
    value.config.otel.exporter = 'otlp-http'
    expect(() => verifyCodexConfiguration(value, 'http://127.0.0.1:1234/secret')).toThrow(
      'unsafe-configuration'
    )
  })
  it('uses a catalog model, preferring an economical family, with no arbitrary model strings', () => {
    expect(
      selectMetadataModel({
        data: [{ model: 'gpt-6-astra', isDefault: true }, { model: 'gpt-6-luna' }]
      })
    ).toBe('gpt-6-luna')
    expect(() => selectMetadataModel({ data: [{ model: '../private/file' }] })).toThrow()
  })
  it('prefers the reviewed standalone version and never invokes a Windows command shim', async () => {
    mocks.readdir.mockResolvedValue([
      '0.160.0-x86_64-pc-windows-msvc',
      '0.157.1-x86_64-pc-windows-msvc'
    ])
    const command = await resolveCodexCommand({ CODEX_HOME: '/login', PATH: '' }, 'win32', 'x64')
    expect(command?.executable).toContain('0.157.1')
    expect(command?.executable).toMatch(/codex\.exe$/)
    expect(command?.args).toEqual([])
  })
  it('checks account status without starting a thread or making inference', async () => {
    expect(await getCodexConnectionStatus()).toEqual({ available: true, connected: true })
    expect(mocks.sent.map((m) => m.method)).toEqual(['initialize', 'config/read', 'account/read'])
    expect(mocks.sent[2].params).toEqual({ refreshToken: false })
    expect(mocks.proxy).not.toHaveBeenCalled()
    expect(mocks.killed).toBe(1)
  })
  it('refuses an unreviewed CLI version and never spawns its app server', async () => {
    mocks.execFile.mockImplementation((_exe, _args, _opts, callback) =>
      callback(null, 'codex-cli 0.999.0\n')
    )
    expect(await getCodexConnectionStatus()).toEqual({
      available: false,
      connected: false,
      errorCode: 'codex-version-unsupported'
    })
    expect(mocks.spawn).not.toHaveBeenCalled()
  })
  it('returns only the proxy-validated result from an ephemeral fresh thread', async () => {
    expect(
      await analyzeMetadataWithCodex(request, {
        italian: true,
        signal: new AbortController().signal
      })
    ).toBe(answer)
    const thread = mocks.sent.find((m) => m.method === 'thread/start')
    expect(thread?.params).toMatchObject({
      ephemeral: true,
      approvalPolicy: 'never',
      modelProvider: 'kudu_metadata',
      dynamicTools: [],
      environments: []
    })
    const turn = mocks.sent.find((m) => m.method === 'turn/start')
    expect(turn?.params).toMatchObject({
      input: [{ type: 'text', text: 'Analyze the supplied metadata.', text_elements: [] }]
    })
    expect(mocks.proxy).toHaveBeenCalledWith(
      request,
      expect.objectContaining({ model: 'gpt-6-luna', italian: true })
    )
    expect(mocks.proxyClose).toHaveBeenCalledOnce()
    expect(mocks.killed).toBe(2)
    expect(mocks.spawn.mock.calls.every((call) => call[2].shell === false)).toBe(true)
  })
  it('shares one inference slot across metadata and performance and releases it after cancellation', async () => {
    mocks.mode = 'pending'
    const controller = new AbortController()
    const pending = analyzeMetadataWithCodex(request, { italian: false, signal: controller.signal })
    void pending.catch(() => {})
    await vi.waitFor(() => expect(mocks.sent.some((m) => m.method === 'turn/start')).toBe(true))
    await expect(
      analyzePerformanceWithCodex(
        {
          source: 'performance',
          durationMs: 0,
          logicalCores: 1,
          totalMemoryBytes: 1024,
          sampleCount: 1,
          expectedSamples: 1,
          interrupted: 0,
          omittedProcessCount: 0,
          windows: [
            {
              sampleTimesMs: [0],
              cpuPercent: null,
              memoryPercent: null,
              memoryUsedBytes: null,
              diskReadBytesPerSec: null,
              diskWriteBytesPerSec: null,
              processes: []
            }
          ]
        },
        { italian: false, signal: new AbortController().signal }
      )
    ).rejects.toThrow('busy')
    controller.abort()
    await expect(pending).rejects.toThrow('cancelled')
    mocks.mode = 'success'
    expect(
      await analyzeMetadataWithCodex(request, {
        italian: false,
        signal: new AbortController().signal
      })
    ).toBe(answer)
  })

  it.each(['server-request', 'tool', 'unknown-notification'])(
    'rejects %s before allowing any further interaction',
    async (mode) => {
      mocks.mode = mode
      await expect(
        analyzeMetadataWithCodex(request, { italian: false, signal: new AbortController().signal })
      ).rejects.toThrow('unsafe-configuration')
      expect(mocks.proxyClose).toHaveBeenCalledOnce()
    }
  )
  it('discovers only integration names and restarts with each explicitly disabled before any account or thread', async () => {
    mocks.mode = 'integrations'
    expect(await getCodexConnectionStatus()).toEqual({ available: true, connected: true })
    expect(mocks.sent.map((message) => message.method)).toEqual([
      'initialize',
      'config/read',
      'initialize',
      'config/read',
      'account/read'
    ])
    expect(mocks.spawn.mock.calls[1][1]).toContain('mcp_servers={"example"={enabled=false}}')
    expect(mocks.spawn.mock.calls[1][1]).toContain('plugins={"example@local"={enabled=false}}')
    expect(mocks.killed).toBe(2)
    expect(mocks.proxy).not.toHaveBeenCalled()
  })
  it('maps a provider failure notification to a fixed error without propagating diagnostics', async () => {
    mocks.mode = 'provider-error'
    await expect(
      analyzeMetadataWithCodex(request, { italian: false, signal: new AbortController().signal })
    ).rejects.toThrow(/^analysis-failed$/)
    expect(mocks.proxyClose).toHaveBeenCalledOnce()
  })
  it('kills the pending analysis and closes its proxy when cancelled', async () => {
    mocks.mode = 'pending'
    const controller = new AbortController()
    const run = analyzeMetadataWithCodex(request, { italian: false, signal: controller.signal })
    const assertion = expect(run).rejects.toThrow('cancelled')
    await vi.waitFor(() => expect(mocks.sent.some((m) => m.method === 'turn/start')).toBe(true))
    controller.abort()
    await assertion
    expect(mocks.proxyClose).toHaveBeenCalledOnce()
    expect(mocks.killed).toBe(2)
  })
})
