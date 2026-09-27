import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'fs'

const mocks = vi.hoisted(() => ({
  getFileIcon: vi.fn(),
  installed: vi.fn(),
  realpath: vi.fn(),
  stat: vi.fn(),
  opendir: vi.fn(),
  readFile: vi.fn()
}))
vi.mock('electron', () => ({
  app: { getFileIcon: mocks.getFileIcon, getAppPath: () => process.cwd(), isPackaged: false }
}))
vi.mock('./program-uninstaller', () => ({ getInstalledProgramsFull: mocks.installed }))
vi.mock('node:fs/promises', () => ({
  realpath: mocks.realpath,
  stat: mocks.stat,
  opendir: mocks.opendir,
  readFile: mocks.readFile
}))

import { findInstalledProgram, localIconPath, normalizeAppName } from './software-icons'
import type { InstalledProgram, UpdateCheckResult, UpToDateApp } from '../../shared/types'

const png = 'data:image/png;base64,AA=='
function program(displayName: string, overrides: Partial<InstalledProgram> = {}): InstalledProgram {
  return {
    id: displayName,
    displayName,
    publisher: '',
    displayVersion: '1.0',
    installDate: '',
    estimatedSize: 0,
    installLocation: '',
    uninstallString: '',
    quietUninstallString: '',
    displayIcon: '',
    registryKey: '',
    isSystemComponent: false,
    isWindowsInstaller: false,
    lastUsed: -1,
    ...overrides
  }
}
function entry(id: string, name = id, source = 'winget'): UpToDateApp {
  return { id, name, source, version: '1.0' }
}
function checkResult(entries: UpToDateApp[]): UpdateCheckResult {
  return {
    apps: [],
    upToDate: entries,
    totalCount: 0,
    majorCount: 0,
    minorCount: 0,
    patchCount: 0,
    packageManagerAvailable: true,
    packageManagerName: 'winget'
  }
}
function directory(files: string[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const name of files) yield { name, isFile: () => true }
    }
  }
}

describe('local software icons', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.resetAllMocks()
    mocks.realpath.mockImplementation(async (path: string) => path)
    mocks.stat.mockResolvedValue({ isFile: () => true })
    mocks.opendir.mockResolvedValue(directory([]))
    mocks.readFile.mockImplementation(async (path: string) => readFileSync(path))
    mocks.getFileIcon.mockResolvedValue({
      isEmpty: () => false,
      resize: () => ({ toDataURL: () => png })
    })
  })

  it('matches display names with versions and architecture suffixes', () => {
    expect(normalizeAppName('Mozilla Firefox 130.0 (x64)')).toBe(
      normalizeAppName('Mozilla Firefox')
    )
    expect(normalizeAppName('7-Zip 24.08 (64-bit)')).toBe(normalizeAppName('7-Zip'))
    expect(normalizeAppName('Mozilla Firefox (x64 it)')).toBe(normalizeAppName('Mozilla Firefox'))
    expect(normalizeAppName('Git version 2.51.0')).toBe('git')
    expect(normalizeAppName('Microsoft Visual Studio Code (User)')).toBe(
      'microsoftvisualstudiocode'
    )
    expect(normalizeAppName('Example 2.0 Preview')).not.toBe(normalizeAppName('Example'))
  })

  it('parses quoted registered icon paths without executing them', () => {
    expect(localIconPath('"C:\\Program Files\\Example\\example.exe",0')).toBe(
      'C:\\Program Files\\Example\\example.exe'
    )
    expect(localIconPath('C:\\Apps\\example.ico')).toBe('C:\\Apps\\example.ico')
    expect(localIconPath('"C:\\Apps\\example.exe,0"')).toBe('C:\\Apps\\example.exe')
  })

  it('refuses network paths, shell commands and non-icon files', () => {
    for (const path of [
      '\\\\server\\share\\app.exe',
      '\\\\?\\C:\\app.exe',
      'https://icons.example/app.ico',
      'app.exe',
      'C:\\app.exe --run',
      'C:\\file.txt',
      'C:\\app.dll',
      'C:\\app.exe:evil.exe',
      'C:\\bad\npath.exe'
    ]) {
      expect(localIconPath(path)).toBeUndefined()
    }
  })

  it('uses complete package IDs and a verified publisher for product-only IDs', () => {
    const vscode = program('Microsoft Visual Studio Code (User)')
    expect(findInstalledProgram(entry('Microsoft.VisualStudioCode', 'VS Code'), [vscode])).toBe(
      vscode
    )
    const steam = program('Steam', { publisher: 'Valve Corporation' })
    expect(findInstalledProgram(entry('Valve.Steam', 'Game library'), [steam])).toBe(steam)
    expect(
      findInstalledProgram(entry('DifferentVendor.Steam', 'Game library'), [steam])
    ).toBeUndefined()
  })

  it('uses an exact registry package ID without confusing other same-name apps', () => {
    const a = program('Editor', { registryKey: 'HKEY_LOCAL_MACHINE\\Uninstall\\Vendor.Editor_is1' })
    const b = program('Editor', { registryKey: 'HKEY_LOCAL_MACHINE\\Uninstall\\Different.Editor' })
    expect(findInstalledProgram(entry('Vendor.Editor', 'Editor'), [a, b])).toBe(a)
  })

  it('matches a uniquely truncated winget name and refuses ambiguous editions', () => {
    const stable = program('A Long Application Name Stable')
    const beta = program('A Long Application Name Beta')
    const item = entry('Vendor.Unknown', 'A Long Application Name…')
    expect(findInstalledProgram(item, [stable])).toBe(stable)
    expect(findInstalledProgram(item, [stable, beta])).toBeUndefined()
    expect(findInstalledProgram(entry('Vendor.Unknown', 'A Long'), [stable])).toBeUndefined()
  })

  it('does not map npm packages or generic names to unrelated desktop programs', () => {
    expect(findInstalledProgram(entry('codex', 'codex', 'npm'), [program('Codex')])).toBeUndefined()
    expect(
      findInstalledProgram(entry('Vendor.Desktop', 'Remote tool'), [
        program('Desktop', { publisher: 'Vendor' })
      ])
    ).toBeUndefined()
  })

  it('adds only an unambiguous local icon and never reads usage history', async () => {
    vi.resetModules()
    const { addSoftwareIcons } = await import('./software-icons')
    mocks.installed.mockResolvedValue([
      { displayName: 'Example 1.2 (x64)', displayIcon: 'C:\\Apps\\example.exe' },
      { displayName: 'Ambiguous', displayIcon: 'C:\\A\\app.exe' },
      { displayName: 'Ambiguous', displayIcon: 'C:\\B\\app.exe' }
    ])
    mocks.getFileIcon.mockResolvedValue({
      isEmpty: () => false,
      resize: () => ({ toDataURL: () => png })
    })
    const result: UpdateCheckResult = {
      apps: [
        {
          id: 'example',
          name: 'Example',
          currentVersion: '1.2',
          availableVersion: '2.0',
          source: 'winget',
          severity: 'major',
          selected: true
        }
      ],
      upToDate: [{ id: 'ambiguous', name: 'Ambiguous', version: '1.0', source: 'winget' }],
      totalCount: 1,
      majorCount: 1,
      minorCount: 0,
      patchCount: 0,
      packageManagerAvailable: true,
      packageManagerName: 'winget'
    }
    await addSoftwareIcons(result, 'win32')
    expect(result.apps[0].iconDataUrl).toBe(png)
    expect(result.upToDate[0].iconDataUrl).toBeUndefined()
    expect(mocks.installed).toHaveBeenCalledWith({ includeUsage: false })
    expect(mocks.getFileIcon).toHaveBeenCalledExactlyOnceWith('C:\\Apps\\example.exe', {
      size: 'normal'
    })
    await addSoftwareIcons(result, 'win32')
    expect(mocks.getFileIcon).toHaveBeenCalledOnce()
  })

  it('recovers a stale registered icon from the matching executable in the install directory', async () => {
    const { addSoftwareIcons } = await import('./software-icons')
    mocks.installed.mockResolvedValue([
      program('Example', {
        displayIcon: 'C:\\Old\\example.exe',
        installLocation: 'C:\\Apps\\Example'
      })
    ])
    mocks.realpath.mockImplementation(async (path: string) => {
      if (path.startsWith('C:\\Old')) throw new Error('ENOENT')
      return path
    })
    mocks.opendir.mockResolvedValue(
      directory(['unins000.exe', 'Updater.exe', 'example.exe', 'helper.exe'])
    )
    const result = checkResult([entry('Vendor.Example', 'Example')])
    await addSoftwareIcons(result, 'win32')
    expect(result.upToDate[0].iconDataUrl).toBe(png)
    expect(mocks.getFileIcon).toHaveBeenCalledExactlyOnceWith('C:\\Apps\\Example\\example.exe', {
      size: 'normal'
    })
    await addSoftwareIcons(result, 'win32')
    expect(mocks.opendir).toHaveBeenCalledOnce()
  })

  it('finds an exact application executable beside a local uninstaller when InstallLocation is empty', async () => {
    const { addSoftwareIcons } = await import('./software-icons')
    mocks.installed.mockResolvedValue([
      program('Example', {
        uninstallString: '"C:\\Apps\\Example\\Uninstall.exe" /S'
      })
    ])
    mocks.opendir.mockResolvedValue(directory(['Uninstall.exe', 'Example.exe', 'Other.exe']))

    const result = checkResult([entry('Vendor.Example', 'Example')])
    await addSoftwareIcons(result, 'win32')

    expect(result.upToDate[0].iconDataUrl).toBe(png)
    expect(mocks.opendir).toHaveBeenCalledExactlyOnceWith('C:\\Apps\\Example')
    expect(mocks.getFileIcon).toHaveBeenCalledExactlyOnceWith('C:\\Apps\\Example\\Example.exe', {
      size: 'normal'
    })
  })

  it('does not infer an icon directory from a system or network uninstaller', async () => {
    const { addSoftwareIcons } = await import('./software-icons')
    mocks.installed.mockResolvedValue([
      program('System', { uninstallString: '"C:\\Windows\\System32\\msiexec.exe" /I{123}' }),
      program('Network', { uninstallString: '"\\\\server\\share\\Uninstall.exe" /S' })
    ])

    await addSoftwareIcons(checkResult([entry('System'), entry('Network')]), 'win32')

    expect(mocks.opendir).not.toHaveBeenCalled()
    expect(mocks.getFileIcon).not.toHaveBeenCalled()
  })

  it('uses a lone application icon when metadata has no DisplayIcon and leaves unrelated executables alone', async () => {
    const { addSoftwareIcons } = await import('./software-icons')
    mocks.installed.mockResolvedValue([
      program('Example', { installLocation: 'C:\\Apps\\Example' }),
      program('Other', { installLocation: 'C:\\Apps\\Other' })
    ])
    mocks.opendir.mockImplementation(async (path: string) =>
      directory(
        path.endsWith('Example') ? ['product.ico', 'uninstall.exe'] : ['first.exe', 'second.exe']
      )
    )
    const result = checkResult([entry('Example'), entry('Other')])
    await addSoftwareIcons(result, 'win32')
    expect(result.upToDate[0].iconDataUrl).toBe(png)
    expect(result.upToDate[1].iconDataUrl).toBeUndefined()
    expect(mocks.getFileIcon).toHaveBeenCalledExactlyOnceWith('C:\\Apps\\Example\\product.ico', {
      size: 'normal'
    })
  })

  it('refuses network destinations after resolving a registered file or installation junction', async () => {
    const { addSoftwareIcons } = await import('./software-icons')
    mocks.installed.mockResolvedValue([
      program('Example', {
        displayIcon: 'C:\\Apps\\Example.exe',
        installLocation: 'C:\\Apps\\Example'
      })
    ])
    mocks.realpath.mockResolvedValue('\\\\server\\share\\example.exe')
    const result = checkResult([entry('Example')])
    await addSoftwareIcons(result, 'win32')
    expect(result.upToDate[0].iconDataUrl).toBeUndefined()
    expect(mocks.getFileIcon).not.toHaveBeenCalled()
    expect(mocks.opendir).not.toHaveBeenCalled()
  })

  it('bounds directory enumeration and does not call a partial listing an unambiguous icon', async () => {
    const { addSoftwareIcons } = await import('./software-icons')
    mocks.installed.mockResolvedValue([
      program('Example', { installLocation: 'C:\\Apps\\Example' })
    ])
    let visited = 0
    let closed = false
    mocks.opendir.mockResolvedValue({
      async *[Symbol.asyncIterator]() {
        try {
          for (let i = 0; i < 1000; i++) {
            visited++
            yield { name: i === 0 ? 'other.exe' : `file-${i}.txt`, isFile: () => true }
          }
        } finally {
          closed = true
        }
      }
    })
    const result = checkResult([entry('Example')])
    await addSoftwareIcons(result, 'win32')
    expect(visited).toBe(129)
    expect(closed).toBe(true)
    expect(result.upToDate[0].iconDataUrl).toBeUndefined()
    expect(mocks.getFileIcon).not.toHaveBeenCalled()
  })

  it('ignores drive roots and skips extraction on other platforms', async () => {
    const { addSoftwareIcons } = await import('./software-icons')
    mocks.installed.mockResolvedValue([program('Example', { installLocation: 'C:\\' })])
    const result = checkResult([entry('Example')])
    await addSoftwareIcons(result, 'linux')
    expect(mocks.installed).not.toHaveBeenCalled()
    await addSoftwareIcons(result, 'win32')
    expect(mocks.opendir).not.toHaveBeenCalled()
    expect(mocks.getFileIcon).not.toHaveBeenCalled()
  })

  it('uses the official packaged k6 logo only for the exact winget ID after local lookup fails', async () => {
    const { addSoftwareIcons } = await import('./software-icons')
    mocks.installed.mockResolvedValue([])
    const result = checkResult([
      entry('Grafana.k6', 'k6'),
      entry('Other.k6', 'k6'),
      entry('Grafana.k6-preview', 'k6'),
      entry('Grafana.k6', 'k6', 'choco')
    ])

    await addSoftwareIcons(result, 'win32')

    expect(result.upToDate[0].iconDataUrl).toMatch(/^data:image\/png;base64,/)
    expect(result.upToDate[1].iconDataUrl).toBeUndefined()
    expect(result.upToDate[2].iconDataUrl).toBeUndefined()
    expect(result.upToDate[3].iconDataUrl).toBeUndefined()
    expect(mocks.readFile).toHaveBeenCalledOnce()
  })

  it('uses the k6 logo for a verified installed publisher, but never replaces a local icon', async () => {
    const { addInstalledProgramIcons } = await import('./software-icons')
    const programs = [
      program('k6', { publisher: 'Raintank Inc. d.b.a. Grafana Labs' }),
      program('k6', { publisher: 'Unrelated Vendor' }),
      program('k6', {
        publisher: 'Raintank Inc. d.b.a. Grafana Labs',
        displayIcon: 'C:\\Apps\\k6.ico'
      })
    ]

    await addInstalledProgramIcons(programs, 'win32')

    expect(programs[0].iconDataUrl).toMatch(/^data:image\/png;base64,/)
    expect(programs[1].iconDataUrl).toBeUndefined()
    expect(programs[2].iconDataUrl).toBe(png)
    expect(mocks.readFile).toHaveBeenCalledOnce()
    expect(mocks.getFileIcon).toHaveBeenCalledExactlyOnceWith('C:\\Apps\\k6.ico', {
      size: 'normal'
    })
  })

  it('enriches the existing uninstall list without querying the registry or dropping failed icons', async () => {
    const { addInstalledProgramIcons } = await import('./software-icons')
    const programs = [
      program('Example', { displayIcon: 'C:\\Apps\\example.exe' }),
      program('Broken', { displayIcon: 'C:\\Apps\\broken.exe' })
    ]
    mocks.realpath.mockImplementation(async (path: string) => {
      if (path.includes('broken')) throw new Error('EACCES')
      return path
    })
    expect(await addInstalledProgramIcons(programs, 'win32')).toBe(programs)
    expect(programs).toHaveLength(2)
    expect(programs[0].iconDataUrl).toBe(png)
    expect(programs[1].iconDataUrl).toBeUndefined()
    expect(mocks.installed).not.toHaveBeenCalled()
  })

  it.each([
    ['remote URL', 'https://example.com/icon.png'],
    ['unsupported MIME', 'data:image/svg+xml;base64,AA=='],
    ['oversized PNG', 'data:image/png;base64,' + 'A'.repeat(65_536)]
  ])('leaves a fallback for an invalid extraction result: %s', async (_label, data) => {
    const { addInstalledProgramIcons } = await import('./software-icons')
    mocks.getFileIcon.mockResolvedValue({
      isEmpty: () => false,
      resize: () => ({ toDataURL: () => data })
    })
    const programs = [program('Example', { displayIcon: 'C:\\Apps\\example.exe' })]
    await addInstalledProgramIcons(programs, 'win32')
    expect(programs[0].iconDataUrl).toBeUndefined()
  })

  it('bounds extraction to 512 entries and four concurrent shell requests', async () => {
    const { addInstalledProgramIcons } = await import('./software-icons')
    let active = 0
    let maxActive = 0
    mocks.getFileIcon.mockImplementation(async () => {
      active++
      maxActive = Math.max(maxActive, active)
      await Promise.resolve()
      active--
      return { isEmpty: () => false, resize: () => ({ toDataURL: () => png }) }
    })
    const programs = Array.from({ length: 513 }, (_, i) =>
      program(`App ${i}`, { displayIcon: `C:\\Apps\\app-${i}.exe` })
    )
    await addInstalledProgramIcons(programs, 'win32')
    expect(mocks.getFileIcon).toHaveBeenCalledTimes(512)
    expect(maxActive).toBeGreaterThan(1)
    expect(maxActive).toBeLessThanOrEqual(4)
    expect(programs[512].iconDataUrl).toBeUndefined()
    expect(programs).toHaveLength(513)
  })
})
