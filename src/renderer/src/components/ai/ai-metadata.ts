import type { AiAnalysisRequest, AiAnalysisSource, AiFileType } from '@shared/ai-analysis'

export const MAX_AI_ITEMS = 100

export interface LocalAiCandidate {
  /** Used only in the renderer to display a recommendation. Never serialized. */
  path: string
  size: number
  lastModified?: number
  lastAccessed?: number
  /** A disk tree row can represent an aggregate directory rather than one file. */
  isDirectory?: boolean
  /** Local duplicate hash/group key. Never serialized. */
  duplicateGroupKey?: string
}

const extensions: Record<Exclude<AiFileType, 'other'>, ReadonlySet<string>> = {
  document: new Set(['pdf', 'doc', 'docx', 'txt', 'rtf', 'odt', 'ppt', 'pptx', 'xls', 'xlsx']),
  image: new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'heic', 'svg']),
  video: new Set(['mp4', 'mkv', 'mov', 'avi', 'webm', 'wmv', 'm4v']),
  audio: new Set(['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'wma']),
  archive: new Set(['zip', '7z', 'rar', 'tar', 'gz', 'bz2', 'xz']),
  application: new Set(['exe', 'msi', 'app', 'dmg', 'deb', 'rpm', 'apk']),
  data: new Set(['db', 'sqlite', 'json', 'csv', 'xml', 'parquet'])
}

export function classifyLocalFile(path: string): AiFileType {
  const basename = path.split(/[\\/]/).pop() ?? ''
  const dot = basename.lastIndexOf('.')
  if (dot < 1) return 'other'
  const extension = basename.slice(dot + 1).toLowerCase()
  for (const [type, known] of Object.entries(extensions)) {
    if (known.has(extension)) return type as AiFileType
  }
  return 'other'
}

function ageBucket(lastModified: number | undefined, now: number): number | null {
  if (lastModified === undefined || !Number.isFinite(lastModified) || lastModified <= 0) return null
  const days = Math.max(0, (now - lastModified) / 86_400_000)
  if (days < 7) return 0
  if (days < 30) return 7
  if (days < 90) return 30
  if (days < 365) return 90
  if (days < 730) return 365
  if (days < 1825) return 730
  return 1825
}

export function buildAiAnalysisRequest(
  source: AiAnalysisSource,
  candidates: LocalAiCandidate[],
  now = Date.now()
): { request: AiAnalysisRequest; localPaths: Map<string, string>; omitted: number } {
  const eligible = candidates.filter(
    (item) => item.path && Number.isFinite(item.size) && item.size >= 0
  )
  const sorted = [...eligible].sort((a, b) => b.size - a.size)
  const included = sorted.slice(0, MAX_AI_ITEMS)
  const localPaths = new Map<string, string>()
  const groupIds = new Map<string, string>()
  const items = included.map((item) => {
    const id = crypto.randomUUID()
    localPaths.set(id, item.path)
    let duplicateGroupId: string | undefined
    if (source === 'duplicates' && item.duplicateGroupKey) {
      duplicateGroupId = groupIds.get(item.duplicateGroupKey)
      if (!duplicateGroupId) {
        duplicateGroupId = crypto.randomUUID()
        groupIds.set(item.duplicateGroupKey, duplicateGroupId)
      }
    }
    return {
      id,
      fileType: item.isDirectory ? 'other' : classifyLocalFile(item.path),
      sizeBytes: Math.round(item.size),
      modifiedAgeDays: ageBucket(item.lastModified, now),
      accessedAgeDays: ageBucket(item.lastAccessed, now),
      ...(duplicateGroupId ? { duplicateGroupId } : {})
    }
  })
  return {
    request: { source, items },
    localPaths,
    omitted: Math.max(0, eligible.length - included.length)
  }
}
