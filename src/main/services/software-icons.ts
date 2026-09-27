import { app } from 'electron'
import { opendir, readFile, realpath, stat } from 'node:fs/promises'
import { join, win32 } from 'node:path'
import { getInstalledProgramsFull } from './program-uninstaller'
import type { InstalledProgram, UpdateCheckResult } from '../../shared/types'

const CACHE_MS = 10 * 60_000
const MAX_DIRECTORY_ENTRIES = 128
let catalog: Promise<IndexedProgram[]> | undefined
let expires = 0
const icons = new Map<string, Promise<string | undefined>>()
const fallbackIcons = new Map<string, Promise<string | undefined>>()
let officialK6Icon: Promise<string | undefined> | undefined
type SoftwareEntry = UpdateCheckResult['upToDate'][number] | UpdateCheckResult['apps'][number]
interface IndexedProgram {
  program: InstalledProgram
  name: string
  registryId: string
  publisher: string
}

export function normalizeAppName(name: string): string {
  return name
    .normalize('NFKC')
    .toLowerCase()
    .trim()
    .replace(
      /(?:\s*\((?:(?:x64|x86|64[- ]bit|32[- ]bit)(?:\s+[a-z]{2}(?:-[a-z]{2})?)?|user|machine)\))+$/i,
      ''
    )
    .replace(/\s+(?:(?:v|version)\s*)?\d+(?:\.\d+)+(?:[-+][\w.-]+)?$/i, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

function localPath(value: string): string | undefined {
  const path = win32.normalize(
    value
      .trim()
      .replace(/,\s*-?\d+$/, '')
      .replace(/^"(.*)"$/, '$1')
      .replace(/,\s*-?\d+$/, '')
      .replace(/%([^%]+)%/g, (match, key: string) => process.env[key] || match)
  )
  if (!/^[a-z]:\\/i.test(path) || !win32.isAbsolute(path) || /[\x00-\x1f"<>|?*]/.test(path)) return
  if (path.slice(2).includes(':')) return
  return path
}

/** Accept only local icon files registered by an installed app, never UNC/network paths. */
export function localIconPath(value: string): string | undefined {
  const path = localPath(value)
  if (!path) return
  if (!['.exe', '.ico'].includes(win32.extname(path).toLowerCase())) return
  return path
}

/** An uninstall command can identify the app directory when InstallLocation is absent. */
function localUninstallDirectory(command: string): string | undefined {
  const match = command.trim().match(/^"([^"]+\.exe)"(?:\s|$)|^([a-z]:\\.+?\.exe)(?:\s|$)/i)
  const executable = match && localIconPath(match[1] || match[2])
  if (!executable) return
  if (
    /^(?:msiexec|rundll32|cmd|powershell|pwsh|regsvr32|wscript|cscript)\.exe$/i.test(
      win32.basename(executable)
    )
  )
    return
  const directory = win32.dirname(executable)
  return directory === win32.parse(directory).root ? undefined : directory
}

const GENERIC_NAMES = new Set([
  'app',
  'application',
  'applications',
  'client',
  'desktop',
  'browser',
  'update',
  'updater',
  'setup',
  'installer',
  'uninstaller',
  'helper',
  'service',
  'bin',
  'windows'
])

function packageNames(item: SoftwareEntry): string[] {
  if (item.source === 'npm') return []
  const keys = [normalizeAppName(item.id)]
  if (item.source === 'winget' && /^[\w-]+(?:\.[\w+-]+)+$/.test(item.id)) {
    keys.push(normalizeAppName(item.id.split('.').slice(1).join(' ')))
  } else if (item.source === 'choco') {
    keys.push(normalizeAppName(item.id.replace(/\.(?:install|portable)$/i, '')))
  } else if (item.source === 'scoop') {
    keys.push(normalizeAppName(item.id.split('/').at(-1) || ''))
  }
  return keys.filter((key) => key.length >= 3 && !GENERIC_NAMES.has(key))
}

/** Match complete names/IDs first. Never use a loose substring or a publisher-only match. */
export function findInstalledProgram(
  item: SoftwareEntry,
  programs: InstalledProgram[]
): InstalledProgram | undefined {
  return matchInstalledProgram(item, indexPrograms(programs))
}

function indexPrograms(programs: InstalledProgram[]): IndexedProgram[] {
  return programs.map((program) => ({
    program,
    name: normalizeAppName(program.displayName),
    registryId: normalizeAppName(win32.basename(program.registryKey || '').replace(/_is1$/i, '')),
    publisher: normalizeAppName((program.publisher || '').split(/[\s,]+/)[0])
  }))
}

function matchInstalledProgram(
  item: SoftwareEntry,
  programs: IndexedProgram[]
): InstalledProgram | undefined {
  if (item.source === 'npm') return
  const packageId = normalizeAppName(item.id)
  const registryMatches = programs.filter(
    ({ registryId }) => registryId && registryId === packageId
  )
  const displayName = normalizeAppName(item.name)
  const names = new Set(packageNames(item))
  const vendor = normalizeAppName(item.id.split('.')[0])
  const nameMatches = programs.filter(({ name, publisher }) => {
    if (name === displayName || name === packageId) return true
    if (!names.has(name)) return false
    // Dropping a winget publisher namespace needs independent registry evidence.
    return item.source !== 'winget' || publisher === vendor
  })
  const truncated = /(?:…|\.{3})$/.test(item.name)
    ? normalizeAppName(item.name.replace(/(?:…|\.{3})$/, ''))
    : ''
  const matches = registryMatches.length
    ? registryMatches
    : nameMatches.length
      ? nameMatches
      : truncated.length >= 16
        ? programs.filter(({ name }) => name.startsWith(truncated))
        : []
  if (matches.length === 1) return matches[0].program
  // Duplicate registry entries can share a single authoritative icon path.
  const paths = new Set(
    matches.map(({ program }) => localIconPath(program.displayIcon)?.toLowerCase())
  )
  if (matches.length && paths.size === 1 && !paths.has(undefined)) return matches[0].program
}

async function installedPrograms(): Promise<IndexedProgram[]> {
  if (!catalog || Date.now() >= expires) {
    expires = Date.now() + CACHE_MS
    icons.clear()
    fallbackIcons.clear()
    catalog = getInstalledProgramsFull({ includeUsage: false })
      .then((programs) => indexPrograms(programs.slice(0, 4096)))
      .catch(() => [])
  }
  return catalog
}

async function readIcon(path: string): Promise<string | undefined> {
  let icon = icons.get(path)
  if (!icon) {
    icon = realpath(path)
      .then(async (resolved) => {
        const local = localIconPath(resolved)
        if (!local || !(await stat(local)).isFile()) return
        return app.getFileIcon(local, { size: 'normal' })
      })
      .then((image) => {
        if (!image || image.isEmpty()) return
        const data = image.resize({ width: 32, height: 32 }).toDataURL()
        return data.startsWith('data:image/png;base64,') && data.length <= 65_536 ? data : undefined
      })
      .catch(() => undefined)
    if (icons.size < 512) icons.set(path, icon)
  }
  return icon
}

async function findFallbackIcon(
  program: InstalledProgram,
  item: SoftwareEntry
): Promise<string | undefined> {
  const directory =
    localPath(program.installLocation || '') ||
    localUninstallDirectory(program.uninstallString || '')
  if (!directory || directory === win32.parse(directory).root) return
  const resolved = localPath(await realpath(directory))
  if (!resolved || resolved === win32.parse(resolved).root) return
  const expected = new Set(
    [
      normalizeAppName(program.displayName),
      normalizeAppName(item.name),
      normalizeAppName(win32.basename(resolved)),
      ...packageNames(item)
    ].filter((name) => name && !GENERIC_NAMES.has(name))
  )
  const candidates: string[] = []
  let count = 0
  let complete = true
  for await (const file of await opendir(resolved)) {
    if (++count > MAX_DIRECTORY_ENTRIES) {
      complete = false
      break
    }
    if (!file.isFile() || !/\.(exe|ico)$/i.test(file.name)) continue
    if (
      /^(?:unins|uninstall|setup|update|installer|crash|helper|maintenance|service|elevate|squirrel)/i.test(
        file.name
      )
    )
      continue
    candidates.push(win32.join(resolved, file.name))
  }
  const matched = candidates.filter((path) =>
    expected.has(normalizeAppName(win32.basename(path, win32.extname(path))))
  )
  const choices = matched.length ? matched : complete && candidates.length === 1 ? candidates : []
  // An .ico and .exe with the same application name are interchangeable sources.
  if (
    new Set(choices.map((path) => normalizeAppName(win32.basename(path, win32.extname(path)))))
      .size !== 1
  )
    return
  choices.sort((a, b) => Number(win32.extname(b) === '.ico') - Number(win32.extname(a) === '.ico'))
  for (const path of choices) {
    const icon = await readIcon(path)
    if (icon) return icon
  }
}

async function programIcon(
  program: InstalledProgram,
  item: SoftwareEntry
): Promise<string | undefined> {
  const registered = localIconPath(program.displayIcon)
  if (registered) {
    const icon = await readIcon(registered)
    if (icon) return icon
  }
  const key = `${program.registryKey || program.displayName}|${item.id}`
  let fallback = fallbackIcons.get(key)
  if (!fallback) {
    fallback = findFallbackIcon(program, item).catch(() => undefined)
    if (fallbackIcons.size < 512) fallbackIcons.set(key, fallback)
  }
  return fallback
}

function officialK6IconDataUrl(): Promise<string | undefined> {
  if (!officialK6Icon) {
    const path = app.isPackaged
      ? join(process.resourcesPath, 'icons', 'software', 'grafana-k6.png')
      : join(app.getAppPath(), 'resources', 'icons', 'software', 'grafana-k6.png')
    officialK6Icon = readFile(path)
      .then((png) => {
        if (
          png.length > 48_000 ||
          !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        )
          return
        return `data:image/png;base64,${png.toString('base64')}`
      })
      .catch(() => undefined)
  }
  return officialK6Icon
}

function isOfficialInstalledK6(program: InstalledProgram): boolean {
  return (
    program.displayName.trim().toLowerCase() === 'k6' &&
    normalizeAppName(program.publisher) === 'raintankincdbagrafanalabs'
  )
}

/** Icons come from local installed applications; no app inventory is sent to an icon service. */
export async function addSoftwareIcons(
  result: UpdateCheckResult,
  platform: NodeJS.Platform = process.platform
): Promise<UpdateCheckResult> {
  if (platform !== 'win32' || result.apps.length + result.upToDate.length === 0) return result
  const programs = await installedPrograms()
  await populateIcons([...result.apps, ...result.upToDate], async (item) => {
    const program = matchInstalledProgram(item, programs)
    const local = program ? await programIcon(program, item) : undefined
    return (
      local ||
      (item.source === 'winget' && item.id === 'Grafana.k6' ? officialK6IconDataUrl() : undefined)
    )
  })
  return result
}

/** Reuse the already-read uninstall catalog rather than querying the registry a second time. */
export async function addInstalledProgramIcons(
  programs: InstalledProgram[],
  platform: NodeJS.Platform = process.platform
): Promise<InstalledProgram[]> {
  if (platform !== 'win32') return programs
  await populateIcons(programs, async (program) => {
    const local = await programIcon(program, {
      id: program.id,
      name: program.displayName,
      version: program.displayVersion,
      source: 'installed'
    })
    return local || (isOfficialInstalledK6(program) ? officialK6IconDataUrl() : undefined)
  })
  return programs
}

async function populateIcons<T extends { iconDataUrl?: string }>(
  items: T[],
  resolveIcon: (item: T) => Promise<string | undefined>
): Promise<void> {
  const entries = items.slice(0, 512)
  let cursor = 0
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (cursor < entries.length) {
        const item = entries[cursor++]
        try {
          const icon = await resolveIcon(item)
          if (icon) item.iconDataUrl = icon
        } catch {
          // Optional decoration must never hide an installed program or block the list.
        }
      }
    })
  )
}
