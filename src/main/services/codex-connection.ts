import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { access, mkdtemp, readdir, rm } from 'fs/promises'
import { homedir, tmpdir } from 'os'
import { delimiter, dirname, isAbsolute, join, resolve, sep } from 'path'
import { StringDecoder } from 'string_decoder'
import type { AiAnalysisRequest, AiAnalysisStatus } from '../../shared/ai-analysis'
import type { PerformanceAiRequest } from '../../shared/performance-ai'
import { aiResponseSchema } from './ai-metadata-policy'
import { performanceAiResponseSchema } from './performance-ai-policy'
import { createMetadataInferenceProxy, type InferenceRequest } from './metadata-inference-proxy'

// A protocol change must be reviewed against the transport's privacy boundary before enabling it.
export const TESTED_CODEX_VERSION = '0.157.1'
const PROVIDER = 'kudu_metadata'
const RPC_TIMEOUT = 45_000
const ANALYSIS_TIMEOUT = 180_000
const MAX_RPC_BYTES = 2 * 1024 * 1024
type JsonObject = Record<string, unknown>
export type CodexCommand = { executable: string; args: string[] }

function record(value: unknown): JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : {}
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/** Resolve exact executables; never execute a .cmd/.bat shim or invoke a shell. */
export async function resolveCodexCommand(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch
): Promise<CodexCommand | null> {
  const executableName = platform === 'win32' ? 'codex.exe' : 'codex'
  const override = env.CODEX_APP_PATH
  if (override && isAbsolute(override) && !/\.(?:cmd|bat|ps1|js)$/i.test(override)) {
    return (await exists(override)) ? { executable: override, args: [] } : null
  }
  const home = env.CODEX_HOME || join(env.USERPROFILE || env.HOME || homedir(), '.codex')
  const candidates: string[] = []
  if (env.LOCALAPPDATA) {
    candidates.push(join(env.LOCALAPPDATA, 'Programs', 'OpenAI', 'Codex', 'bin', executableName))
  }
  const target = `${arch === 'arm64' ? 'aarch64' : 'x86_64'}-${platform === 'win32' ? 'pc-windows-msvc' : platform === 'darwin' ? 'apple-darwin' : 'unknown-linux-musl'}`
  const releases = join(home, 'packages', 'standalone', 'releases')
  const installed = await readdir(releases).catch(() => [])
  for (const version of installed
    .filter((name) => /^\d+\.\d+\.\d+-/.test(name) && name.endsWith(target))
    .sort(
      (a, b) =>
        Number(b.startsWith(TESTED_CODEX_VERSION + '-')) -
          Number(a.startsWith(TESTED_CODEX_VERSION + '-')) ||
        b.localeCompare(a, undefined, { numeric: true })
    )
    .slice(0, 20)) {
    candidates.push(join(releases, version, 'bin', executableName))
  }
  const pathEntries = (env.PATH || env.Path || '')
    .split(delimiter)
    .map((entry) => entry.replace(/^"|"$/g, ''))
    .filter((entry) => isAbsolute(entry))
  const npmRoots = new Set<string>()
  for (const entry of pathEntries) {
    candidates.push(join(entry, executableName))
    npmRoots.add(join(entry, 'node_modules'))
    npmRoots.add(join(dirname(entry), 'lib', 'node_modules'))
  }
  if (env.APPDATA) npmRoots.add(join(env.APPDATA, 'npm', 'node_modules'))
  // npm's optional platform packages contain the same native CLI as the standalone install.
  const platformPackage = `codex-${platform}-${arch}`
  for (const npmRoot of npmRoots) {
    const cliRoot = join(npmRoot, '@openai', 'codex')
    for (const vendorRoot of [
      join(cliRoot, 'vendor'),
      join(npmRoot, '@openai', platformPackage, 'vendor'),
      join(cliRoot, 'node_modules', '@openai', platformPackage, 'vendor')
    ]) {
      candidates.push(join(vendorRoot, target, 'codex', executableName))
    }
  }
  for (const candidate of candidates) {
    if (await exists(candidate)) return { executable: candidate, args: [] }
  }
  return null
}

const DISABLED_FEATURES = [
  'hooks',
  'plugins',
  'apps',
  'remote_plugin',
  'recommended_plugins',
  'plugin_sharing',
  'shell_tool',
  'unified_exec',
  'shell_snapshot',
  'shell_snapshot_v2',
  'view_image',
  'image_generation',
  'browser_use',
  'browser_use_external',
  'browser_use_full_cdp_access',
  'computer_use',
  'multi_agent',
  'multi_agent_v2',
  'memories',
  'external_agent_memory_import',
  'skill_search',
  'skill_mcp_dependency_install',
  'code_mode',
  'code_mode_host',
  'code_mode_prewarm',
  'workspace_dependencies',
  'worktrees',
  'tool_suggest',
  'auth_elicitation',
  'enable_request_compression',
  'unbounded_connection_retries',
  'daemon_auto_start',
  'goals',
  'sleep_tool',
  'in_app_local_automation'
] as const

export function codexConfigArgs(
  baseUrl: string,
  logDirectory?: string,
  integrationOverrides: string[] = []
): string[] {
  const url = new URL(baseUrl)
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    !url.port ||
    url.search ||
    url.hash
  ) {
    throw new Error('unsafe-configuration')
  }
  const overrides = [
    'mcp_servers={}',
    'plugins={}',
    'notify=[]',
    'approval_policy="never"',
    'sandbox_mode="read-only"',
    'web_search="disabled"',
    'project_doc_max_bytes=0',
    'project_doc_fallback_filenames=[]',
    'analytics.enabled=false',
    'otel.exporter="none"',
    'otel.metrics_exporter="none"',
    'otel.trace_exporter="none"',
    'otel.log_user_prompt=false',
    'history.persistence="none"',
    'shell_environment_policy.inherit="none"',
    'include_environment_context=false',
    'include_apps_instructions=false',
    'include_collaboration_mode_instructions=false',
    'include_permissions_instructions=false',
    // Reuse Codex's existing state database: a fresh SQLite home reimports the user's rollout
    // index on every startup. Kudu never opens/copies that database; the new thread is ephemeral.
    ...(logDirectory ? [`log_dir=${JSON.stringify(logDirectory)}`] : []),
    'features.skip_host_skill_discovery=true',
    ...DISABLED_FEATURES.map((feature) => `features.${feature}=false`),
    ...integrationOverrides,
    `model_provider="${PROVIDER}"`,
    // Pin this provider's route; the effective configuration is checked again before any thread.
    `model_providers={${PROVIDER}={name="SuperSonicCleaner metadata",base_url=${JSON.stringify(baseUrl)},wire_api="responses",requires_openai_auth=true,supports_websockets=false,request_max_retries=0,stream_max_retries=0}}`
  ]
  return [
    'app-server',
    '--stdio',
    '--strict-config',
    ...overrides.flatMap((value) => ['-c', value])
  ]
}

/** Preserve the original login location, but no arbitrary provider credentials or Node hooks. */
export function codexEnvironment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const allowed = new Set([
    'PATH',
    'PATHEXT',
    'SYSTEMROOT',
    'WINDIR',
    'COMSPEC',
    'HOME',
    'USERPROFILE',
    'LOCALAPPDATA',
    'APPDATA',
    'TMP',
    'TEMP',
    'TMPDIR',
    'LANG',
    'LC_ALL'
  ])
  const clean: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(env)) {
    if (allowed.has(key.toUpperCase())) clean[key] = value
  }
  clean.CODEX_HOME = env.CODEX_HOME || join(env.USERPROFILE || env.HOME || homedir(), '.codex')
  clean.RUST_LOG = 'off'
  return clean
}

export function disabledIntegrationOverrides(value: unknown): string[] {
  const config = record(record(value).config)
  const overrides: string[] = []
  for (const group of ['mcp_servers', 'plugins']) {
    const entries: string[] = []
    for (const name of Object.keys(record(config[group]))) {
      if (name.length > 200 || entries.length >= 100) throw new Error('unsafe-configuration')
      entries.push(`${JSON.stringify(name)}={enabled=false}`)
    }
    // Dotted CLI keys treat quotes literally. Inline TOML preserves integration names with dots.
    overrides.push(`${group}={${entries.join(',')}}`)
  }
  return overrides
}

export function verifyCodexConfiguration(
  value: unknown,
  baseUrl: string,
  discoveryOnly = false
): void {
  const config = record(record(value).config)
  const features = record(config.features)
  const providers = record(config.model_providers)
  const provider = record(providers[PROVIDER])
  if (
    (!discoveryOnly &&
      [config.mcp_servers, config.plugins].some((group) =>
        Object.values(record(group)).some((entry) => record(entry).enabled !== false)
      )) ||
    !Array.isArray(config.notify) ||
    config.notify.length !== 0 ||
    DISABLED_FEATURES.some((feature) => features[feature] !== false) ||
    config.model_provider !== PROVIDER ||
    provider.base_url !== baseUrl ||
    provider.requires_openai_auth !== true ||
    provider.supports_websockets !== false ||
    [
      'env_key',
      'experimental_bearer_token',
      'auth',
      'gateway_oauth',
      'aws',
      'query_params',
      'http_headers',
      'env_http_headers',
      'model_catalog_url'
    ].some((key) => provider[key] != null) ||
    config.project_doc_max_bytes !== 0 ||
    record(config.analytics).enabled !== false ||
    record(config.otel).exporter !== 'none' ||
    record(config.otel).metrics_exporter !== 'none' ||
    record(config.otel).trace_exporter !== 'none'
  )
    throw new Error('unsafe-configuration')
}

export function selectMetadataModel(value: unknown): string {
  const data = record(value).data
  if (!Array.isArray(data)) throw new Error('codex-unavailable')
  const candidates = data
    .map(record)
    .filter(
      (model) =>
        model.hidden !== true &&
        typeof model.model === 'string' &&
        /^gpt-[a-z0-9][a-z0-9.-]{0,60}$/.test(model.model)
    )
  const selected =
    candidates.find((model) => /(?:luna|mini|nano)(?:-|$)/.test(model.model as string)) ||
    candidates.find((model) => model.isDefault === true) ||
    candidates[0]
  if (!selected) throw new Error('codex-unavailable')
  return selected.model as string
}

const SAFE_NOTIFICATIONS = new Set([
  'thread/started',
  'thread/status/changed',
  'thread/settings/updated',
  'thread/closed',
  'thread/tokenUsage/updated',
  'turn/started',
  'turn/completed',
  'item/started',
  'item/completed',
  'item/agentMessage/delta',
  'item/reasoning/summaryTextDelta',
  'item/reasoning/summaryPartAdded',
  'item/reasoning/textDelta',
  'account/updated',
  'remoteControl/status/changed',
  'account/rateLimits/updated',
  'model/verification',
  'modelProvider/authRecoveryStarted',
  'modelProvider/authRecoveryCompleted',
  'turn/moderationMetadata',
  'model/safetyBuffering/updated',
  'warning',
  'deprecationNotice',
  'configWarning',
  'windows/worldWritableWarning'
])

class CodexRpc {
  private nextId = 0
  private buffer = ''
  private bytes = 0
  private decoder = new StringDecoder('utf8')
  private stopped = false
  private failure: Error | null = null
  private readonly closed: Promise<void>
  private pending = new Map<
    number,
    { resolve(value: unknown): void; reject(error: Error): void; timer: NodeJS.Timeout }
  >()
  private turns = new Map<string, { resolve(): void; reject(error: Error): void }>()
  constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    signal: AbortSignal
  ) {
    this.closed = new Promise((resolve) => child.once('close', () => resolve()))
    child.stdout.on('data', (chunk: Buffer) => this.receive(chunk))
    child.stdin.on('error', () => this.stop('codex-unavailable'))
    // Never collect, persist, or expose diagnostics: they can contain account/configuration data.
    child.stderr.resume()
    child.on('error', () => this.stop('codex-unavailable'))
    child.on('close', () => this.stop('codex-unavailable'))
    const abort = () => this.stop('cancelled')
    signal.addEventListener('abort', abort, { once: true })
    child.once('close', () => signal.removeEventListener('abort', abort))
    if (signal.aborted) abort()
  }
  request(method: string, params: JsonObject): Promise<unknown> {
    if (this.stopped) return Promise.reject(this.failure || new Error('codex-unavailable'))
    const id = ++this.nextId
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.stop('timeout'), RPC_TIMEOUT)
      this.pending.set(id, { resolve, reject, timer })
      this.child.stdin.write(JSON.stringify({ id, method, params }) + '\n', (error) => {
        if (error) this.stop('codex-unavailable')
      })
    })
  }
  initialized(): void {
    this.child.stdin.write(
      JSON.stringify({ method: 'initialized', params: {} }) + '\n',
      (error) => {
        if (error) this.stop('codex-unavailable')
      }
    )
  }
  async close(): Promise<void> {
    this.stop()
    let timer: NodeJS.Timeout | undefined
    await Promise.race([
      this.closed,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, 2_000)
      })
    ])
    clearTimeout(timer)
  }
  completed(threadId: string): Promise<void> {
    if (this.stopped) return Promise.reject(this.failure || new Error('codex-unavailable'))
    return new Promise((resolve, reject) => this.turns.set(threadId, { resolve, reject }))
  }
  stop(code = 'cancelled'): void {
    if (this.stopped) return
    this.stopped = true
    this.failure = new Error(code)
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer)
      entry.reject(this.failure)
    }
    this.pending.clear()
    for (const turn of this.turns.values()) turn.reject(this.failure)
    this.turns.clear()
    this.buffer = ''
    this.child.kill()
  }
  private receive(chunk: Buffer): void {
    if (this.stopped) return
    this.bytes += chunk.length
    if (this.bytes > MAX_RPC_BYTES) return this.stop('invalid-response')
    this.buffer += this.decoder.write(chunk)
    let newline: number
    while ((newline = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newline)
      this.buffer = this.buffer.slice(newline + 1)
      let message: JsonObject
      try {
        message = record(JSON.parse(line))
      } catch {
        return this.stop('invalid-response')
      }
      // No approvals, tool calls, input requests, or authentication callbacks may be executed.
      if (message.method && message.id !== undefined) return this.stop('unsafe-configuration')
      if (typeof message.id === 'number') {
        const request = this.pending.get(message.id)
        if (request) {
          clearTimeout(request.timer)
          this.pending.delete(message.id)
          if (message.error) request.reject(new Error('analysis-failed'))
          else request.resolve(message.result)
        }
      } else {
        if (message.method === 'error') return this.stop('analysis-failed')
        if (!SAFE_NOTIFICATIONS.has(message.method as string))
          return this.stop('unsafe-configuration')
        const params = record(message.params)
        if (message.method === 'remoteControl/status/changed' && params.status !== 'disabled') {
          return this.stop('unsafe-configuration')
        }
        if (message.method === 'item/started' || message.method === 'item/completed') {
          const type = record(params.item).type
          if (!['userMessage', 'agentMessage', 'reasoning'].includes(type as string)) {
            return this.stop('unsafe-configuration')
          }
        }
        if (message.method === 'turn/completed' && typeof params.threadId === 'string') {
          const turn = this.turns.get(params.threadId)
          this.turns.delete(params.threadId)
          if (record(params.turn).status === 'completed') turn?.resolve()
          else turn?.reject(new Error('analysis-failed'))
        }
      }
    }
  }
}

async function checkedCommand(): Promise<CodexCommand> {
  const command = await resolveCodexCommand()
  if (!command) throw new Error('codex-not-found')
  const version = await new Promise<string>((resolve, reject) => {
    execFile(
      command.executable,
      [...command.args, '--version'],
      {
        timeout: 8_000,
        maxBuffer: 4096,
        windowsHide: true,
        shell: false,
        env: codexEnvironment()
      },
      (error, stdout) => (error ? reject(new Error('codex-unavailable')) : resolve(stdout.trim()))
    )
  })
  if (version !== `codex-cli ${TESTED_CODEX_VERSION}`) throw new Error('codex-version-unsupported')
  return command
}

let integrationOverrides: string[] = []

async function startConnection(
  baseUrl: string,
  signal: AbortSignal
): Promise<{ rpc: CodexRpc; close(): Promise<void>; cwd: string }> {
  const command = await checkedCommand()
  if (signal.aborted) throw new Error('cancelled')
  const cwd = await mkdtemp(join(tmpdir(), 'kudu-ai-'))
  let rpc: CodexRpc | undefined
  const close = async () => {
    await rpc?.close()
    // The only recursively removed directory is the fresh, app-created neutral working directory.
    if (resolve(cwd).startsWith(resolve(tmpdir()) + sep)) {
      await rm(cwd, { recursive: true, force: true, maxRetries: 2 }).catch(() => undefined)
    }
  }
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (signal.aborted) throw new Error('cancelled')
      const child = spawn(
        command.executable,
        [...command.args, ...codexConfigArgs(baseUrl, cwd, integrationOverrides)],
        {
          cwd,
          env: codexEnvironment(),
          shell: false,
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe']
        }
      )
      rpc = new CodexRpc(child, signal)
      await rpc.request('initialize', {
        clientInfo: { name: 'kudu_metadata', title: 'SuperSonicCleaner', version: '1.0.0' },
        capabilities: { experimentalApi: true }
      })
      rpc.initialized()
      const configuration = await rpc.request('config/read', { includeLayers: false })
      // Discovery is strictly initialize/config-only: there is never a thread, turn or tool session.
      verifyCodexConfiguration(configuration, baseUrl, true)
      const config = record(record(configuration).config)
      const enabled = [config.mcp_servers, config.plugins].some((group) =>
        Object.values(record(group)).some((entry) => record(entry).enabled !== false)
      )
      if (enabled && attempt === 0) {
        integrationOverrides = disabledIntegrationOverrides(configuration)
        await rpc.close()
        continue
      }
      verifyCodexConfiguration(configuration, baseUrl)
      return { rpc, close, cwd }
    }
    throw new Error('unsafe-configuration')
  } catch (error) {
    await close()
    throw error
  }
}

export function aiErrorCode(error: unknown): NonNullable<AiAnalysisStatus['errorCode']> {
  const code = error instanceof Error ? error.message : ''
  return [
    'codex-not-found',
    'codex-version-unsupported',
    'not-connected',
    'codex-unavailable',
    'unsafe-configuration',
    'busy',
    'cancelled',
    'timeout',
    'invalid-metadata',
    'invalid-response'
  ].includes(code)
    ? (code as NonNullable<AiAnalysisStatus['errorCode']>)
    : 'analysis-failed'
}

export async function getCodexConnectionStatus(signal?: AbortSignal): Promise<AiAnalysisStatus> {
  const controller = new AbortController()
  const cancel = () => controller.abort()
  signal?.addEventListener('abort', cancel, { once: true })
  if (signal?.aborted) cancel()
  const timeout = setTimeout(() => controller.abort(), 100_000)
  let connection: Awaited<ReturnType<typeof startConnection>> | undefined
  try {
    // No model request is made by status. The provider cannot route inference to the internet.
    connection = await startConnection('http://127.0.0.1:1/status-only', controller.signal)
    const account = record(await connection.rpc.request('account/read', { refreshToken: false }))
    const connected = record(account.account).type === 'chatgpt'
    return { available: true, connected, ...(connected ? {} : { errorCode: 'not-connected' }) }
  } catch (error) {
    const errorCode = aiErrorCode(error)
    return {
      connected: false,
      available: !['codex-not-found', 'codex-version-unsupported'].includes(errorCode),
      errorCode
    }
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', cancel)
    await connection?.close()
  }
}

let inferenceActive = false

export function analyzeMetadataWithCodex(
  request: AiAnalysisRequest,
  options: { italian: boolean; signal: AbortSignal }
): Promise<string> {
  return analyzeWithCodex(request, options)
}

export function analyzePerformanceWithCodex(
  request: PerformanceAiRequest,
  options: { italian: boolean; signal: AbortSignal }
): Promise<string> {
  return analyzeWithCodex(request, options)
}

async function analyzeWithCodex(
  request: InferenceRequest,
  options: { italian: boolean; signal: AbortSignal }
): Promise<string> {
  if (inferenceActive) throw new Error('busy')
  inferenceActive = true
  const controller = new AbortController()
  const cancel = () => controller.abort()
  options.signal.addEventListener('abort', cancel, { once: true })
  if (options.signal.aborted) cancel()
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, ANALYSIS_TIMEOUT)
  let connection: Awaited<ReturnType<typeof startConnection>> | undefined
  let proxy: Awaited<ReturnType<typeof createMetadataInferenceProxy>> | undefined
  try {
    // Catalog/account discovery has no thread and no user input. Only inference uses the proxy.
    connection = await startConnection('http://127.0.0.1:1/catalog-only', controller.signal)
    const account = record(await connection.rpc.request('account/read', { refreshToken: false }))
    if (record(account.account).type !== 'chatgpt') throw new Error('not-connected')
    const model = selectMetadataModel(
      await connection.rpc.request('model/list', { includeHidden: false, limit: 100 })
    )
    await connection.close()
    connection = undefined
    proxy = await createMetadataInferenceProxy(request, {
      model,
      italian: options.italian,
      signal: controller.signal
    })
    connection = await startConnection(proxy.baseUrl, controller.signal)
    const started = record(
      await connection.rpc.request('thread/start', {
        model,
        modelProvider: PROVIDER,
        allowProviderModelFallback: false,
        approvalPolicy: 'never',
        sandbox: 'read-only',
        ephemeral: true,
        cwd: connection.cwd,
        runtimeWorkspaceRoots: [],
        environments: [],
        selectedCapabilityRoots: [],
        baseInstructions: 'Return the requested structured answer. No tools are available.',
        developerInstructions: '',
        dynamicTools: []
      })
    )
    const threadId = record(started.thread).id
    if (typeof threadId !== 'string') throw new Error('invalid-response')
    const completed = connection.rpc.completed(threadId)
    // Attach a handler immediately, including when turn/start itself fails.
    void completed.catch(() => undefined)
    await connection.rpc.request('turn/start', {
      threadId,
      model,
      input: [{ type: 'text', text: 'Analyze the supplied metadata.', text_elements: [] }],
      approvalPolicy: 'never',
      outputSchema:
        request.source === 'performance'
          ? performanceAiResponseSchema(request)
          : aiResponseSchema(request),
      effort: 'low',
      environments: []
    })
    await completed
    const result = proxy.getResult()
    if (!result) throw new Error('invalid-response')
    return result
  } catch (error) {
    // Deliberately omit the cause: upstream diagnostics can contain private paths or account data.
    // eslint-disable-next-line preserve-caught-error
    throw new Error(timedOut ? 'timeout' : aiErrorCode(error))
  } finally {
    clearTimeout(timeout)
    options.signal.removeEventListener('abort', cancel)
    try {
      await Promise.allSettled([connection?.close(), proxy?.close()])
    } finally {
      inferenceActive = false
    }
  }
}
