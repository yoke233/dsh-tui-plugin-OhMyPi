import type { AgentStatus } from '@deepseek-ai/dsh-agent'
import { matchesKey } from '@earendil-works/pi-tui'

export type RunningTurnKeyAction = 'clear-draft' | 'cancel'

export interface ComposerFocusController<T> {
  getFocusedComponent(): unknown
  setFocus(component: T): void
}

/**
 * Reassert the main composer's focus if the TUI has no input owner. Called
 * before key dispatch so the key that detects the loss still reaches the
 * editor.
 */
export function restoreComposerFocus<T>(
  ui: ComposerFocusController<T>,
  editor: T,
  composerOwnsInput: boolean,
): boolean {
  if (!composerOwnsInput || ui.getFocusedComponent() !== null) return false
  ui.setFocus(editor)
  return true
}

/** Resolve Ctrl+C/Escape without letting a non-empty draft cancel or exit. */
export function runningTurnKeyAction(
  data: string,
  status: AgentStatus | undefined,
  editorFocused: boolean,
  draft: string,
): RunningTurnKeyAction | undefined {
  if (!editorFocused) return undefined
  if (matchesKey(data, 'ctrl+c') && draft !== '') return 'clear-draft'
  if (status !== 'running') return undefined
  if (matchesKey(data, 'ctrl+c') || matchesKey(data, 'escape')) return 'cancel'
  return undefined
}
