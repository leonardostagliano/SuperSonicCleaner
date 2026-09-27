import { isAbsolute, join } from 'path'

export const APP_NAME = 'SuperSonicCleaner'
export const APP_ID = 'com.leonardostagliano.supersoniccleaner'
export const STARTUP_TASK_NAME = 'SuperSonicCleanerStartup'
export const DATA_DIRECTORY_ARGUMENT = '--supersonic-cleaner-data-dir='

/** Explicit profile selections win; a fresh launch never reuses upstream's default data. */
export function resolveProfileDirectory(args: string[], appDataDirectory: string): string {
  for (const prefix of [DATA_DIRECTORY_ARGUMENT, '--kudu-data-dir=', '--user-data-dir=']) {
    const inline = args.find((arg) => arg.startsWith(prefix))
    const separate = args.indexOf(prefix.slice(0, -1))
    const value = inline?.slice(prefix.length) ?? (separate >= 0 ? args[separate + 1] : undefined)
    if (value && isAbsolute(value)) return value
  }
  return join(appDataDirectory, APP_NAME)
}
