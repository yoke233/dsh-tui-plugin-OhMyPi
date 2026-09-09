import { existsSync, rmSync } from 'node:fs'

/** Reproduce selecting a persisted session from the /resume picker. */
export async function run(tui) {
  const turnEnded = tui.marker('resume-picker-turn-ended')
  const renamed = tui.marker('resume-picker-renamed')
  const forked = tui.marker('resume-picker-forked')
  rmSync(turnEnded, { force: true })
  rmSync(renamed, { force: true })
  rmSync(forked, { force: true })
  const fixture = tui.packFixture({
    name: 'dsh-live-resume-picker-fixture',
    patch: [
      '- insert:',
      '    - id: live-resume-picker-llm',
      "      name: 'dsh-live-resume-picker-fixture'",
      '- id: agent-default-model',
      '  config:',
      '    provider: resume-picker-fixture',
      '    model: controlled',
      '',
    ].join('\n'),
    source: [
      "import { writeFileSync } from 'node:fs'",
      "import { join } from 'node:path'",
      "import { LlmAdapter } from '@deepseek-ai/dsh-llm'",
      "export const inject = ['llm']",
      'class ControlledAdapter extends LlmAdapter {',
      "  async resolveModel(provider, model) { return { provider, id: model, name: model, reasoning: { efforts: [{ id: 'max', name: 'Max' }], defaultEffort: 'max' } } }",
      '  async * stream() {',
      "    yield { type: 'block-start', index: 0, blockType: 'text' }",
      "    yield { type: 'text-delta', index: 0, text: 'RESUME_PICKER_REPLY' }",
      "    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'RESUME_PICKER_REPLY' } }",
      "    yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }",
      "    yield { type: 'finish', reason: { kind: 'stop' } }",
      '  }',
      '}',
      'export function apply(ctx) {',
      "  ctx.llm.registerAdapter(['resume-picker-fixture'], new ControlledAdapter())",
      "  ctx.on('session/event', (_session, event) => {",
      "    if (event.type === 'turn/end') writeFileSync(join(process.env.DSH_HOME, 'resume-picker-turn-ended'), 'ok')",
      "    if (event.type === 'session/title' && event.data.source.kind === 'user') writeFileSync(join(process.env.DSH_HOME, 'resume-picker-renamed'), event.data.title)",
      '  })',
      "  ctx.on('session/created', (session) => {",
      "    if (session.header.parentSession !== undefined) writeFileSync(join(process.env.DSH_HOME, 'resume-picker-forked'), String(session.id))",
      '  })',
      '}',
      '',
    ].join('\n'),
  })
  tui.runDsh(['plugin', '--profile', 'tui', 'add', fixture])
  await tui.start()
  await tui.waitForOutput(/欢迎回来|Welcome back/, { timeoutMs: 60_000, label: 'welcome screen' })
  await tui.waitForSlashMenu({ expected: /→\s+palette/, timeoutMs: 15_000 })
  tui.key('\x15')
  tui.submit('/mode minimal')
  await tui.waitForSlashMenu({ expected: /→\s+palette/, timeoutMs: 15_000 })
  tui.key('\x15')
  tui.submit('RESUME_PICKER_PROMPT')
  await tui.waitForOutput('RESUME_PICKER_REPLY', { timeoutMs: 30_000, label: 'first session reply' })
  await tui.waitFor(() => existsSync(turnEnded), 15_000, 'persisted first turn')
  await tui.waitForSlashMenu({ expected: /→\s+palette/, timeoutMs: 15_000 })
  tui.key('\x15')
  tui.submit('/rename Parent Renamed')
  await tui.waitFor(() => existsSync(renamed), 15_000, 'parent renamed')
  await tui.waitForSlashMenu({ expected: /→\s+palette/, timeoutMs: 15_000 })
  tui.key('\x15')

  const forkOffset = tui.mark()
  rmSync(forked, { force: true })
  tui.submit('/fork Child Branch')
  await tui.waitFor(() => existsSync(forked), 15_000, 'fork created')
  await tui.waitForOutput('RESUME_PICKER_PROMPT', { since: forkOffset, timeoutMs: 15_000, label: 'fork inherited transcript' })
  await tui.waitForSlashMenu({ expected: /→\s+palette/, timeoutMs: 15_000 })
  tui.key('\x15')
  rmSync(turnEnded, { force: true })
  const childTurnOffset = tui.mark()
  tui.submit('CHILD_ONLY_PROMPT')
  await tui.waitForOutput('RESUME_PICKER_REPLY', { since: childTurnOffset, timeoutMs: 15_000, label: 'child-only turn reply' })
  await tui.waitFor(() => existsSync(turnEnded), 15_000, 'persisted child-only turn')
  await tui.waitForScreen('CHILD_ONLY_PROMPT', { timeoutMs: 15_000, label: 'child-only prompt visible' })
  await tui.waitForSlashMenu({ expected: /→\s+palette/, timeoutMs: 15_000 })
  tui.key('\x15')

  const pickerOffset = tui.mark()
  tui.submit('/resume')
  await tui.waitForOutput(/恢复会话|Resume session/, { since: pickerOffset, timeoutMs: 15_000, label: 'resume picker' })
  await tui.waitForOutput('Parent Renamed', { since: pickerOffset, timeoutMs: 15_000, label: 'renamed parent in picker' })
  tui.key('\r')
  await tui.waitFor(async () => {
    const screen = await tui.screenText()
    return !screen.includes('CHILD_ONLY_PROMPT') && !/恢复会话|Resume session/.test(screen)
  }, 15_000, 'selected parent transcript replaces child transcript')
  await tui.waitForSlashMenu({ expected: /→\s+palette/, timeoutMs: 15_000 })
  tui.key('\x15')

  tui.submit('/resume Child Branch')
  await tui.waitForScreen('CHILD_ONLY_PROMPT', { timeoutMs: 15_000, label: 'fork resumed by name' })
  await tui.waitForSlashMenu({ expected: /→\s+palette/, timeoutMs: 15_000 })
  tui.key('\x15')
  tui.submit('/resume Parent Renamed')
  await tui.waitFor(async () => !(await tui.screenText()).includes('CHILD_ONLY_PROMPT'), 15_000, 'renamed parent resumed by name')
  return {
    forkWorks: true,
    renameWorks: true,
    resumePickerSelectionWorks: true,
    resumeByNameWorks: true,
    screenshot: await tui.snapshot('resume-picker'),
  }
}
