import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Session, SessionId, SessionLogOffset, SESSION_FORMAT_VERSION, type SessionEvent } from '@deepseek-ai/dsh-session'
import { ConversationWriteGate, repairLegacySequenceGaps, repairLegacyToolEvents } from '../src/session-persistence.ts'

function event(seq: number, type: string): SessionEvent {
  return { seq, time: seq, type, data: {} } as SessionEvent
}

describe('conversation-gated persistence', () => {
  it('buffers metadata and releases the complete prefix on first conversation data', () => {
    const gate = new ConversationWriteGate()
    const id = SessionId('fresh')
    assert.equal(gate.stage(id, [event(0, 'permission/preset')], false), undefined)
    assert.equal(gate.stage(id, [event(1, 'sandbox/mode')], true), undefined)

    const released = gate.stage(id, [event(2, 'user/message')], true)
    assert.equal(released?.isMaterialized, false)
    assert.deepEqual(released?.events.map(item => [item.seq, item.type]), [
      [0, 'permission/preset'],
      [1, 'sandbox/mode'],
      [2, 'user/message'],
    ])

    const later = gate.stage(id, [event(3, 'turn/start')], true)
    assert.equal(later?.isMaterialized, true)
    assert.deepEqual(later?.events.map(item => item.seq), [3])
  })

  it('passes writes for an already materialized resumed session through', () => {
    const gate = new ConversationWriteGate()
    const write = gate.stage(SessionId('resumed'), [event(4, 'turn/start')], true)
    assert.equal(write?.isMaterialized, true)
    assert.deepEqual(write?.events.map(item => item.seq), [4])
  })

  it('drops abandoned metadata when a blank session is disposed', () => {
    const gate = new ConversationWriteGate()
    const id = SessionId('abandoned')
    assert.equal(gate.stage(id, [event(0, 'approval/policy')], false), undefined)
    gate.drop(id)
    const write = gate.stage(id, [event(1, 'turn/start')], true)
    assert.deepEqual(write?.events.map(item => item.seq), [1])
  })

  it('repairs legacy empty tool call ids so a stored session can be restored', () => {
    const id = SessionId('repair-empty-tool-call')
    const events = [
      {
        type: 'tool/call',
        seq: 0,
        time: 0,
        data: { turn: 0, step: 0, callId: '', name: '', arguments: '' },
      },
      {
        type: 'tool/result',
        seq: 1,
        time: 1,
        data: {
          turn: 0,
          step: 0,
          message: {
            id: 'm1',
            role: 'user',
            source: { kind: 'tool', callId: '' },
            content: [{ type: 'tool-result', toolCallId: '', content: [{ type: 'text', text: 'ok' }] }],
          },
        },
        surfaceOp: 'append',
        sourceEventSeqs: [0],
      },
    ] as unknown as SessionEvent[]

    const repaired = repairLegacyToolEvents(events) as SessionEvent[]
    const session = Session.fromRestore(id, repaired, {
      version: SESSION_FORMAT_VERSION,
      id,
      createdAt: 0,
      isSeeded: false,
    }, SessionLogOffset(0))

    assert.equal(session.snapshotEvents().length, 3) // tool/call + tool/result + session/end-seed
    const call = session.snapshotEvents()[0] as { data: { callId: string; name: string; arguments: string } }
    assert.equal(call.data.callId, 'call-0')
    assert.equal(call.data.name, 'unknown')
    assert.equal(call.data.arguments, '{}')
    const result = session.snapshotEvents()[1] as { data: { message: { source: { callId: string }; content: [{ toolCallId: string }] } } }
    assert.equal(result.data.message.source.callId, 'call-0')
    assert.equal(result.data.message.content[0].toolCallId, 'call-0')
  })

  it('fills a bounded committed sequence gap with ignorable compatibility events', () => {
    const id = SessionId('repair-sequence-gap')
    const events = [
      {
        type: 'turn/end',
        seq: 0,
        time: 10,
        data: { turn: 1, reason: { kind: 'interrupted' } },
      },
      {
        type: 'step/start',
        seq: 3,
        time: 20,
        data: { turn: 2, step: 1 },
      },
      {
        type: 'step/end',
        seq: 4,
        time: 21,
        data: { turn: 2, step: 1 },
      },
      {
        type: 'turn/end',
        seq: 5,
        time: 22,
        data: { turn: 2, reason: { kind: 'error', error: { message: 'legacy failure', code: 'UNKNOWN' } } },
      },
    ] as unknown as SessionEvent[]

    const repaired = repairLegacySequenceGaps(events) as SessionEvent[]
    assert.deepEqual(repaired.map(item => item.seq), [0, 1, 2, 3, 4, 5])
    assert.deepEqual(repaired.slice(1, 3).map(item => ({
      type: item.type,
      ignorable: item.ignorable,
      data: item.data,
    })), [
      {
        type: 'omdsh/legacy-sequence-gap',
        ignorable: true,
        data: { fromSeq: 1, toSeq: 2, nextType: 'step/start' },
      },
      {
        type: 'omdsh/legacy-sequence-gap',
        ignorable: true,
        data: { fromSeq: 1, toSeq: 2, nextType: 'step/start' },
      },
    ])

    const session = Session.fromRestore(id, repaired, {
      version: SESSION_FORMAT_VERSION,
      id,
      createdAt: 0,
      isSeeded: false,
    }, SessionLogOffset(0))
    assert.equal(session.snapshotEvents().length, 7)
  })

  it('refuses to guess across a sequence gap inside an unfinished turn', () => {
    assert.throws(
      () => repairLegacySequenceGaps([
        event(0, 'step/start'),
        event(2, 'assistant/chunk'),
      ]),
      /cannot safely repair sequence gap/,
    )
  })
})
