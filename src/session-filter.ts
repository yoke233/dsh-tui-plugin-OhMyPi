import { resolve } from 'node:path'
import type { SessionRecord } from '@deepseek-ai/dsh-session-query'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { normalizeSessionTitle } from '@deepseek-ai/dsh-session-title'

/** Compare session cwd values using the host platform's path semantics. */
export function sameProject(left: string | null | undefined, right: string): boolean {
  if (left === undefined || left === null) return false
  const leftPath = resolve(left)
  const rightPath = resolve(right)
  return process.platform === 'win32'
    ? leftPath.toLocaleLowerCase() === rightPath.toLocaleLowerCase()
    : leftPath === rightPath
}

/** Keep only persisted top-level sessions whose cwd belongs to the active project. */
export function filterProjectSessions(records: readonly SessionRecord[], workspace: string): SessionRecord[] {
  return records.filter(record =>
    record.persisted
    && record.header.origin !== 'subagent'
    && sameProject(record.header.cwd, workspace))
}

/** Resume-picker candidates exclude the active session, which cannot be resumed into itself. */
export function filterResumeSessions(
  records: readonly SessionRecord[],
  workspace: string,
  currentSessionId: SessionId,
): SessionRecord[] {
  return filterProjectSessions(records, workspace)
    .filter(record => String(record.header.id) !== String(currentSessionId))
}

/** One resume candidate enriched with its optional folded title. */
export interface NamedSessionRecord {
  readonly record: SessionRecord
  readonly title?: string
}

/** Result of resolving a user supplied session id or renamed title. */
export type SessionSelectorResult =
  | { readonly kind: 'found'; readonly id: SessionId }
  | { readonly kind: 'ambiguous'; readonly ids: readonly SessionId[] }
  | { readonly kind: 'not-found' }

/** Resolve ids first, then exact normalized titles (case-insensitively). */
export function resolveSessionSelector(
  candidates: readonly NamedSessionRecord[],
  selector: string,
): SessionSelectorResult {
  const exactId = candidates.find(candidate => String(candidate.record.header.id) === selector)
  if (exactId !== undefined) return { kind: 'found', id: exactId.record.header.id }

  const wanted = normalizeSessionTitle(selector, Number.MAX_SAFE_INTEGER).toLocaleLowerCase()
  if (wanted === '') return { kind: 'not-found' }
  const titleMatches = candidates.filter(candidate =>
    candidate.title !== undefined
    && normalizeSessionTitle(candidate.title, Number.MAX_SAFE_INTEGER).toLocaleLowerCase() === wanted)
  if (titleMatches.length === 1) return { kind: 'found', id: titleMatches[0]!.record.header.id }
  if (titleMatches.length > 1) {
    return { kind: 'ambiguous', ids: titleMatches.map(candidate => candidate.record.header.id) }
  }
  return { kind: 'not-found' }
}
