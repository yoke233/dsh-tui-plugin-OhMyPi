import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { filterProjectSessions, filterResumeSessions, resolveSessionSelector, sameProject } from '../src/session-filter.ts'
import type { SessionRecord } from '@deepseek-ai/dsh-session-query'

function record(cwd: string | null, persisted: boolean, id: string, origin?: 'subagent'): SessionRecord {
  return {
    header: { cwd, id, origin } as unknown as SessionRecord['header'],
    live: false,
    persisted,
  }
}

describe('project session filtering', () => {
  it('keeps only persisted top-level sessions from the active project', () => {
    const workspace = process.cwd()
    const records = [
      record(workspace, true, 'same'),
      record(workspace, true, 'child', 'subagent'),
      record(workspace, false, 'live-only'),
      record('D:/other-project', true, 'other'),
      record(null, true, 'unknown'),
    ]
    assert.deepEqual(filterProjectSessions(records, workspace).map(item => String(item.header.id)), ['same'])
  })

  it('uses case-insensitive comparison on Windows', () => {
    const workspace = process.cwd()
    const equivalent = process.platform === 'win32' ? workspace.toUpperCase() : workspace
    assert.equal(sameProject(equivalent, workspace), true)
    assert.equal(sameProject('D:/definitely-not-this-project', workspace), false)
  })

  it('does not offer the active persisted session in the resume picker', () => {
    const workspace = process.cwd()
    const records = [record(workspace, true, 'current'), record(workspace, true, 'other')]
    assert.deepEqual(
      filterResumeSessions(records, workspace, 'current' as never).map(item => String(item.header.id)),
      ['other'],
    )
  })
})

describe('session selector resolution', () => {
  const workspace = process.cwd()
  const named = (id: string, title?: string) => ({ record: record(workspace, true, id), title })

  it('prefers an exact session id over a colliding title', () => {
    const result = resolveSessionSelector([named('target', 'Other'), named('other', 'target')], 'target')
    assert.deepEqual(result, { kind: 'found', id: 'target' })
  })

  it('resolves a renamed title with normalized whitespace and case', () => {
    const result = resolveSessionSelector([named('session-1', 'My renamed session')], '  MY  renamed session  ')
    assert.deepEqual(result, { kind: 'found', id: 'session-1' })
  })

  it('reports duplicate titles as ambiguous instead of picking arbitrarily', () => {
    const result = resolveSessionSelector([named('one', 'Same'), named('two', 'same')], 'same')
    assert.deepEqual(result, { kind: 'ambiguous', ids: ['one', 'two'] })
  })
})
