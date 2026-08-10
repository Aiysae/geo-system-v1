import type {
  GeoEvidenceLevel,
  GeoKnowledgeAssetKind,
  GeoKnowledgeAssetStatus,
} from "./geo-methodology"

export type KnowledgeImportStatus =
  | "queued"
  | "extracting"
  | "review"
  | "committing"
  | "completed"
  | "failed"
  | "cancelled"

export interface KnowledgeImportFileRecord {
  id: string
  name: string
  mimeType: string
  extension: string
  sizeBytes: number
  sha256: string
  pageCount?: number
  sheetNames?: string[]
  extractedChars: number
}

export interface KnowledgeImportCandidate {
  id: string
  kind: GeoKnowledgeAssetKind
  title: string
  content: string
  evidenceLevel: GeoEvidenceLevel
  status: GeoKnowledgeAssetStatus
  sourceUrls: string[]
  tags: string[]
  occurredAt?: string
  sourceFileName?: string
  sourceLocator?: string
  subjectName?: string
  duplicateOf?: string
  conflictWith?: string[]
  issues?: string[]
  selected: boolean
}

export interface KnowledgeImportRecord {
  id: string
  clientId: string
  teamId?: string
  requestId: string
  backgroundJobId?: string
  status: KnowledgeImportStatus
  stage: string
  progressPercent: number
  files: KnowledgeImportFileRecord[]
  candidates: KnowledgeImportCandidate[]
  approvedCount: number
  error?: string
  createdAt: string
  updatedAt: string
  finishedAt?: string
}
