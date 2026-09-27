/** Only these allowlisted metadata fields may cross the AI transport boundary. */
export type AiAnalysisSource = 'cleaner' | 'large-files' | 'duplicates' | 'disk'

export type AiFileType =
  'document' | 'image' | 'video' | 'audio' | 'archive' | 'application' | 'data' | 'other'

export interface AiAnalysisItem {
  /** Fresh opaque ID for this one request; never a scanner ID, path, or hash. */
  id: string
  fileType: AiFileType
  sizeBytes: number
  /** Coarse age bucket, with no original timestamp or date string. */
  modifiedAgeDays: number | null
  /** Filesystem access age, not necessarily the last time a person opened it. */
  accessedAgeDays: number | null
  /** Fresh opaque ID shared only by copies in one duplicate group. */
  duplicateGroupId?: string
}

export interface AiAnalysisRequest {
  source: AiAnalysisSource
  items: AiAnalysisItem[]
}

export interface AiAnalysisRecommendation {
  fileId: string
  priority: 'low' | 'medium' | 'high'
  reason: string
}

export interface AiAnalysisResult {
  summary: string
  recommendations: AiAnalysisRecommendation[]
}

export interface AiAnalysisStatus {
  connected: boolean
  available: boolean
  /** Fixed, sanitized code. Never an upstream error body. */
  errorCode?:
    | 'codex-not-found'
    | 'codex-version-unsupported'
    | 'not-connected'
    | 'codex-unavailable'
    | 'unsafe-configuration'
    | 'busy'
    | 'cancelled'
    | 'timeout'
    | 'invalid-metadata'
    | 'invalid-response'
    | 'analysis-failed'
}
