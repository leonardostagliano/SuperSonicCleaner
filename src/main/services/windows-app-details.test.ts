import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { APP_ID } from './app-identity'
import { windowsAppDetails } from './windows-app-details'

const options = {
  executable: 'C:\\Program Files\\SuperSonicCleaner\\SuperSonicCleaner.exe',
  userDataDir: 'C:\\Users\\Test User\\AppData\\Roaming\\SuperSonicCleaner',
  isPackaged: true,
  appPath: 'C:\\project',
  iconPath: 'C:\\Program Files\\SuperSonicCleaner\\resources\\icon.ico'
}

describe('Windows taskbar identity', () => {
  it('uses the installer identity, product icon and relaunch name', () => {
    expect(readFileSync(resolve('electron-builder.yml'), 'utf8')).toContain(`appId: ${APP_ID}`)
    expect(windowsAppDetails(options)).toEqual({
      appId: APP_ID,
      appIconPath: options.iconPath,
      appIconIndex: 0,
      relaunchDisplayName: 'SuperSonicCleaner',
      relaunchCommand: `"${options.executable}" "--supersonic-cleaner-data-dir=${options.userDataDir}"`
    })
  })

  it('retains the application entry when pinning a development launch', () => {
    expect(
      windowsAppDetails({
        ...options,
        executable: 'C:\\project\\electron.exe',
        isPackaged: false,
        argv: ['electron', 'C:\\my project'],
        cwd: 'C:\\project'
      }).relaunchCommand
    ).toBe(
      `"C:\\project\\electron.exe" "C:\\my project" "--supersonic-cleaner-data-dir=${options.userDataDir}"`
    )
  })

  it('pins the real packaged executable when execPath is a temporary alias', () => {
    const root = mkdtempSync(join(tmpdir(), 'supersonic-pin-'))
    try {
      const realDir = join(root, 'real package')
      const resourcesPath = join(realDir, 'resources')
      const executable = join(realDir, 'SuperSonicCleaner.exe')
      mkdirSync(resourcesPath, { recursive: true })
      writeFileSync(executable, '')

      const alias = join(root, 'temporary alias', basename(executable))
      mkdirSync(dirname(alias))
      writeFileSync(alias, '')
      const details = windowsAppDetails({ ...options, executable: alias, resourcesPath })
      const expected = realpathSync.native(join(dirname(resourcesPath), basename(alias)))
      expect(details.relaunchCommand).toBe(
        `"${expected}" "--supersonic-cleaner-data-dir=${options.userDataDir}"`
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
