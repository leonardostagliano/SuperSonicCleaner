import { statfs } from 'fs/promises'
import type { DriveInfo } from '../../shared/types'

/** Enumerating volumes spawns PowerShell (1–4 s on Windows): reuse the list briefly. */
export const DRIVE_LIST_TTL_MS = 30_000

/**
 * Caches the drive list for `ttlMs`. A load that fails, or that resolves to
 * an empty list (the loader's own failure fallback), is returned to the
 * caller as-is but never stored, so the next `get()` loads again instead of
 * serving a false "no drives" result for the full TTL.
 */
export function createDriveCache(
  load: () => Promise<DriveInfo[]>,
  ttlMs = DRIVE_LIST_TTL_MS,
  now: () => number = Date.now
): { get(): Promise<DriveInfo[]>; peek(): DriveInfo[] | null; invalidate(): void } {
  let cached: { at: number; drives: DriveInfo[] } | null = null
  let inFlight: Promise<DriveInfo[]> | null = null
  return {
    get() {
      if (cached && now() - cached.at < ttlMs) return Promise.resolve(cached.drives)
      inFlight ??= load()
        .then((drives) => {
          if (drives.length > 0) cached = { at: now(), drives }
          return drives
        })
        .finally(() => {
          inFlight = null
        })
      return inFlight
    },
    /** The cached list, or null; never starts a load. */
    peek() {
      return cached?.drives ?? null
    },
    invalidate() {
      cached = null
    }
  }
}

type StatfsFn = (path: string) => Promise<{ bsize: number; blocks: number; bavail: number }>

/**
 * The Windows system drive in microseconds, straight from the filesystem, so
 * the dashboard does not wait for the full volume list. Null elsewhere or on
 * failure; callers then fall back to the list.
 */
export async function readSystemDrive({
  env = process.env,
  platform = process.platform,
  statfsFn = statfs,
  knownDrives = []
}: {
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  statfsFn?: StatfsFn
  knownDrives?: DriveInfo[]
} = {}): Promise<DriveInfo | null> {
  if (platform !== 'win32') return null
  const letter = (env.SystemDrive || 'C:').replace(/[:\\/]+$/, '').toUpperCase()
  try {
    const stats = await statfsFn(`${letter}:\\`)
    const totalSize = stats.blocks * stats.bsize
    const freeSpace = stats.bavail * stats.bsize
    if (!(totalSize > 0)) return null
    const known = knownDrives.find((d) => d.letter.toUpperCase() === letter)
    return {
      letter,
      label: known?.label || letter,
      isSystem: true,
      totalSize,
      freeSpace,
      usedSpace: totalSize - freeSpace
    }
  } catch {
    return null
  }
}
