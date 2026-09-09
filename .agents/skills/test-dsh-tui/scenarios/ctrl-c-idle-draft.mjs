/** Ctrl+C clears a non-empty idle draft without exiting the TUI. */
export async function run(tui) {
  await tui.start()
  await tui.waitForOutput(/欢迎回来|Welcome back/, {
    timeoutMs: 30_000,
    label: 'welcome screen',
  })
  const pidBefore = tui.pid()

  for (const char of 'IDLE_DRAFT_TO_CLEAR') tui.key(char)
  await tui.waitForScreen('IDLE_DRAFT_TO_CLEAR', {
    timeoutMs: 5_000,
    label: 'idle draft',
  })

  tui.key('\x03')
  await tui.waitFor(async () => {
    const screen = await tui.screenText()
    return !screen.includes('IDLE_DRAFT_TO_CLEAR')
  }, 5_000, 'Ctrl+C cleared idle draft')

  for (const char of 'EDITOR_STILL_ALIVE') tui.key(char)
  await tui.waitForScreen('EDITOR_STILL_ALIVE', {
    timeoutMs: 5_000,
    label: 'editor remains usable',
  })

  const pidAfter = tui.pid()
  if (pidBefore !== pidAfter) {
    throw new Error(`DSH PID changed: ${pidBefore} -> ${pidAfter}`)
  }

  return {
    idleDraftCleared: true,
    editorStayedUsable: true,
    processStayedLive: true,
    pidBefore,
    pidAfter,
  }
}
