import { describe, expect, it } from 'vitest'
import { buildWindowsElevationCommand, getWindowsRelaunchArgs } from './elevation'

const development = {
  executable: String.raw`C:\Kudu Project\node_modules\electron\dist\electron.exe`,
  userDataDir: String.raw`C:\Users\Alice\Kudu Profile`,
  isPackaged: false,
  appPath: String.raw`C:\Kudu Project`,
  cwd: String.raw`C:\Kudu Project`,
  argv: ['electron.exe', '.'],
  parentPid: 1234
}

function decodeHelper(command: string): string {
  const encoded = command.match(/-EncodedCommand ([A-Za-z0-9+/=]+)/)?.[1]
  expect(encoded).toBeDefined()
  return Buffer.from(encoded!, 'base64').toString('utf16le')
}

describe('Windows elevated relaunch', () => {
  it('passes the development project to Electron and keeps the active profile', () => {
    expect(getWindowsRelaunchArgs(development)).toEqual([
      String.raw`C:\Kudu Project`,
      String.raw`--supersonic-cleaner-data-dir=C:\Users\Alice\Kudu Profile`
    ])
  })

  it('preserves a built entry file and resolves relative entries before elevation', () => {
    expect(
      getWindowsRelaunchArgs({ ...development, argv: ['electron.exe', 'out/main/index.js'] })[0]
    ).toBe(String.raw`C:\Kudu Project\out\main\index.js`)
  })

  it('uses the application path if an Electron entry is unavailable', () => {
    expect(getWindowsRelaunchArgs({ ...development, argv: ['electron.exe'] })[0]).toBe(
      development.appPath
    )
    expect(
      getWindowsRelaunchArgs({ ...development, argv: ['electron.exe', '--inspect=9229'] })[0]
    ).toBe(development.appPath)
  })

  it('launches packaged Kudu without adding a development entry or startup flags', () => {
    expect(
      getWindowsRelaunchArgs({
        ...development,
        isPackaged: true,
        argv: ['Kudu.exe', '--startup', '--kudu-data-dir=old-profile']
      })
    ).toEqual([String.raw`--supersonic-cleaner-data-dir=C:\Users\Alice\Kudu Profile`])
  })

  it('waits for the old process before launching Kudu and surfaces UAC cancellation', () => {
    const command = buildWindowsElevationCommand(development)
    expect(command).toContain('-Verb RunAs -WindowStyle Hidden -ErrorAction Stop')
    const helper = decodeHelper(command)
    expect(helper).toContain('Wait-Process -Id 1234 -ErrorAction SilentlyContinue; Start-Process')
    expect(helper).toContain(`-FilePath '${development.executable}'`)
    expect(helper).toContain(`-WorkingDirectory '${development.cwd}'`)
    expect(helper).toContain(
      String.raw`-ArgumentList '"C:\Kudu Project" "--supersonic-cleaner-data-dir=C:\Users\Alice\Kudu Profile"'`
    )
  })

  it('quotes apostrophes, spaces and a trailing directory separator without shell expansion', () => {
    const helper = decodeHelper(
      buildWindowsElevationCommand({
        ...development,
        executable: String.raw`C:\Alice's tools\electron.exe`,
        userDataDir: `${String.raw`C:\Alice's $(profile)`}\\`,
        argv: ['electron.exe', String.raw`C:\Alice's project\out\main\index.js`]
      })
    )
    expect(helper).toContain(String.raw`-FilePath 'C:\Alice''s tools\electron.exe'`)
    expect(helper).toContain(
      String.raw`-ArgumentList '"C:\Alice''s project\out\main\index.js" "--supersonic-cleaner-data-dir=C:\Alice''s $(profile)\\"'`
    )
  })
})
