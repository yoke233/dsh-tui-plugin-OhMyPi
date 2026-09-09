/**
 * Interactive DeepSeek Harness front door, visually aligned with the local
 * OMP 17.2.15 Catppuccin layout while retaining dsh-native agent, session,
 * command, and persistence contracts.
 * @module @yoke233/omdsh
 */

import { statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, isAbsolute, join, resolve } from 'node:path'
import { Service, type Context } from '@deepseek-ai/cordis'
import {
  Container,
  ProcessTerminal,
  Spacer,
  TuiMainScreen,
  Text,
  matchesKey,
  visibleWidth,
  type Component,
  type EditorTheme,
  type SelectItem,
  type TUI,
  type TerminalColorScheme,
} from '@earendil-works/pi-tui'
import { PromptEditor } from './components/prompt-editor.ts'
import type { Agent, AgentHandle, AgentStatus, ModelSelection, ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import { CombinedAutocompleteProvider, type AutocompleteItem, type SlashCommand } from '@earendil-works/pi-tui'
import { createUserMessage, errorChain, type ToolCallId, type ContentBlock, type LlmConfigurableProvider, type LlmReasoningEffortInfo } from '@deepseek-ai/dsh-llm'
import type { EncodedImageAttachment } from '@deepseek-ai/dsh-attachment'
import { SessionId, SessionLogOffset, type Session, type SessionEvent, type UserMessage } from '@deepseek-ai/dsh-session'
import { scopeOf } from '@deepseek-ai/dsh-scope'
import { foldSessionTitle } from '@deepseek-ai/dsh-session-title'
import { parseSessionReferenceText } from '@deepseek-ai/dsh-session-reference'
import { isUserInvocable, renderSkillContent } from '@deepseek-ai/dsh-skill'
// Type-only imports pull in the declaration merges that expose `ctx.commands`,
// `ctx.attachments`, `ctx.tokenMeter`, `ctx.llm`, `ctx.userQuestions`, `ctx.approval`, `ctx.sessionQuery`,
// `ctx.agentDefaultModel`, `ctx.skills`, `ctx.sessionReferenceResolver`, and
// `ctx.permissionPresets` on the cordis Context, plus the goal/compaction/skill
// session-event extensions.
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-token-meter'
import type {} from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-user-questions'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-session-reference'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-tool-todo'
import { PERMISSION_SETTINGS_NAMESPACE } from '@deepseek-ai/dsh-permission-presets'
import type {} from '@deepseek-ai/dsh-permission-presets'
import type {} from '@deepseek-ai/dsh-goal'
import type {} from '@deepseek-ai/dsh-compaction'
import type {} from '@deepseek-ai/dsh-jobs'
import type {} from '@deepseek-ai/dsh-llm-retry/types'
import type {} from '@deepseek-ai/dsh-shell'
// Declaration merge: the `hook/invoked` / `hook/result` session events written
// by the dsh-hooks-claude-code bridge (via dsh-hook-protocol).
import type {} from '@deepseek-ai/dsh-hook-protocol'
import type { ToolCallView, ToolResult, ToolResultView } from '@deepseek-ai/dsh-tools'
// Declaration merges: `ctx.agentPresets`, its `agentPreset` projection, and
// the `agent-preset/selected` session event.
import type {} from '@deepseek-ai/dsh-agent-presets'
import {
  DEFAULT_LEFT_PROMPT,
  DEFAULT_RIGHT_PROMPT,
  TuiConfigSchema,
  resolveTuiConfig,
  type Config,
  type ResolvedTuiConfig,
} from './config.ts'
import type { TuiStartup } from './startup.ts'
import {
  RELOAD_EXIT_CODE,
  RELOAD_HANDOFF_ENV,
  armExitWatchdog,
  nextGenerationArgs,
  writeReloadHandoff,
} from './respawn.ts'
import { parseTuiPromptTemplate } from './prompt.ts'
import { createTranslator, displayErrorCode, type MessageKey, type Translator } from './i18n.ts'
import { orderJobs, registerJobsCommand } from './jobs.ts'
import { restoreComposerFocus, runningTurnKeyAction } from './input.ts'
import {
  FULL_ACCESS_REGISTRY_NAME,
  FULL_ACCESS_UI_NAME,
  displayPermissionName,
  permissionCommandMetadata,
  registryPermissionName,
} from './permission.ts'
import {
  SkillAwareAutocompleteProvider,
  observeAutocompleteSelection,
  parseSkillInvocation,
  syncSkillCommands,
} from './autocomplete.ts'
import {
  BUILTIN_THEMES,
  COLOR_ROLES,
  createPalette,
  detectTruecolor,
  findTheme,
  markdownTheme,
  renderPalette,
  selectTheme,
  type Palette,
  type ThemeCustom,
  type ThemeMode,
  type ThemeOverride,
} from './theme.ts'
import { completedThemeCandidate, isThemeAutocompleteContext, resolveThemeCommand } from './theme-command.ts'
import { redrawThemePreview } from './theme-preview-render.ts'
import {
  SESSION_TITLE_SETTINGS_NAMESPACE,
  TUI_SETTINGS_NAMESPACE,
  TuiSettingsSchema,
} from './settings.ts'
import {
  ContextCardComponent,
  BackgroundJobViewComponent,
  ErrorMessageComponent,
  HeaderComponent,
  StaticCardComponent,
  SubagentPanelComponent,
  TranscriptFoldNoticeComponent,
  TranscriptViewport,
  AssistantStreamController,
  TodoPanelComponent,
  TRANSCRIPT_LOAD_EVENT_STEP,
  ToolCardComponent,
  UserMessageComponent,
  applyCardVisibility,
  nextToolCardVisibility,
  registerVisibilityCard,
  toolDetail,
  toolLabel,
  recentTranscriptStart,
  type ToolCardVisibility,
} from './components/transcript.ts'
import {
  PendingInputPanel,
  mergePendingInput,
  recallablePendingInput,
  retainedPendingInputContent,
  shouldProjectImmediateUserInput,
  shouldProjectPendingInput,
} from './components/pending-input.ts'
import {
  CommandHintComponent,
  ComposerFooterComponent,
  InputBorderComponent,
  StatusLineComponent,
  WorkingIndicatorComponent,
  formatContextTokens,
  chooseReasoningEffort,
  resolveSessionModelSelection,
} from './components/status.ts'
import {
  InputDialog,
  SelectDialog,
  runInlineQuestionFlow,
  runModelFlow,
  showOverlay,
} from './components/dialogs.ts'
import { runApprovalFlow } from './components/approval-dialog.ts'
import { ModelListDialog } from './components/model-list-dialog.ts'
import { SettingsScreen, type SettingsItem, type SettingsTab } from './components/settings-screen.ts'
import { ContextUsageScreen, buildContextUsageSnapshot } from './components/context-usage-screen.ts'
import { CustomModelForm, type CustomModelDraft } from './components/custom-model-form.ts'
import {
  ProviderForm,
  SUPPORTED_PROVIDER_APIS,
  type DiscoveredModel,
  type ProviderDraft,
} from './components/provider-form.ts'
import { contentText } from './components/content.ts'
import { latestAssistantText, osc52ClipboardSequence } from './clipboard.ts'
import {
  ImagePasteDraft,
  encodeImageSubmission,
  isImagePasteShortcut,
  pastedImageFilePath,
  readClipboardImage,
  readPastedImageFile,
} from './image-paste.ts'
import { displayInlineText, displayText } from './components/text.ts'
import { createOrcaStatusReporter } from './orca-status.ts'
import { WorkingWordRotation, compactingActivityText, formatWorkingElapsed, workingActivityText } from './working-words.ts'
import { formatRetryDelay, requestAttemptForTurn, retryActivity, type RetryActivity } from './retry-display.ts'
import {
  parseBangShellCommand,
  parseShellUserMessage,
  renderShellResultText,
  serializeShellUserMessage,
  shellCommandResult,
  shellInfrastructureFailure,
  shellResultFailed,
  type ShellCommandResult,
} from './shell-command.ts'
import { filterProjectSessions, filterResumeSessions, resolveSessionSelector, sameProject } from './session-filter.ts'
import { foldSessionView, hasConversationData, liveChildSubagents, recordConversationPreset, sessionSubagent } from './session-lifecycle.ts'
import type { BridgeConfig, WechatBridge } from './wechat/index.ts'
import { setActiveAgent } from './wechat/dsh/session.ts'
import { setTuiForegroundControl } from './wechat/dsh/tui-control.ts'

export const name = 'tui'

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const SPINNER_INTERVAL_MS = 80
/** How long to wait for the configured agent to publish before giving up. */
const AGENT_READY_TIMEOUT_MS = 30000
/** Safety cap for a session resume's persistence load and setup phase. */
const RESUME_TIMEOUT_MS = 30_000
/** How many recent sessions to show in the `/resume` picker before title reads. */
const RESUME_PICKER_LIMIT = 50
/** Safety cap for loading title snapshots before showing the `/resume` picker. */
const RESUME_TITLES_TIMEOUT_MS = 5_000
/** Context fallback while exact model metadata is unavailable. */
const DEFAULT_CONTEXT_WINDOW = 1_000_000

/** Optional localized labels for official presets; roster ids remain authoritative. */
const MODE_LABEL_KEYS: Readonly<Record<string, MessageKey>> = {
  standard: 'modeStandard',
  minimal: 'modeMinimal',
  ptc: 'modeCode',
  cordis: 'modeCordis',
}



/** Restore a session's projected backend preset, falling back for blank sessions. */
function modeForSession(recorded: string | null | undefined, fallback: string): string {
  return recorded ?? fallback
}

/** The localized label of a preset id, preferring the roster's own name. */
function modeLabel(
  t: Translator,
  mode: string,
  names: ReadonlyMap<string, string>,
): string {
  const rosterName = names.get(mode)
  if (rosterName !== undefined) return rosterName
  const labelKey = MODE_LABEL_KEYS[mode]
  return labelKey === undefined ? mode : t(labelKey)
}

/** Filter preset argument choices while preserving their descriptions. */
function filterCommandOptions(options: readonly AutocompleteItem[], prefix: string): AutocompleteItem[] | null {
  const query = prefix.trim().toLocaleLowerCase()
  const filtered = query === ''
    ? options
    : options.filter(item => `${item.value} ${item.label}`.toLocaleLowerCase().startsWith(query))
  return filtered.length === 0 ? null : [...filtered]
}

/** Show the command's expected argument while the user edits its prefix. */
function commandInputHint(text: string, commands: readonly SlashCommand[]): string | undefined {
  const match = /^\/([^\s]*)/.exec(text)
  if (match?.[1] === undefined) return undefined
  const command = commands.find(entry => entry.name === match[1])
  return command?.argumentHint
}

/** Format a token count compactly: 1234 → "1.2k", 1234567 → "1.2M". */
function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`
  return String(count)
}



/** Resolve a regular repository or linked worktree branch without spawning Git. */
async function readGitBranch(cwd: string): Promise<string | undefined> {
  const dotGit = join(cwd, '.git')
  let gitDir = dotGit
  try {
    const pointer = (await readFile(dotGit, 'utf8')).trim()
    const match = /^gitdir:\s*(.+)$/i.exec(pointer)
    if (match?.[1] !== undefined) {
      gitDir = isAbsolute(match[1]) ? match[1] : resolve(cwd, match[1])
    }
  } catch {
    // A normal checkout exposes `.git` as a directory, not a pointer file.
  }
  try {
    const head = (await readFile(join(gitDir, 'HEAD'), 'utf8')).trim()
    if (head.startsWith('ref:')) return head.slice(head.lastIndexOf('/') + 1)
    return head === '' ? undefined : head.slice(0, 7)
  } catch {
    return undefined
  }
}

/** The terminal mode's plugin entry: mounts the whole UI in its constructor. */
export class Tui extends Service {
  static inject = ['tuiStartup', 'agents', 'tuiPrompt', 'commands', 'attachments', 'jobs', 'tokenMeter', 'llm', 'shell', 'userQuestions', 'approval', 'sessionQuery', 'sessionProjections', 'agentDefaultModel', 'skills', 'sessionReferenceResolver', 'agentPresets', 'permissionPresets', 'settings', 'sessionTitle']
  static Config = TuiConfigSchema

  /** Mount 后由 TUI 赋值：读取当前前台 agent。 */
  private foregroundAgentImpl: (() => Agent | undefined) | undefined

  /** Mount 后由 TUI 赋值：按 TUI `/new` 逻辑创建会话并切到前台。 */
  private createForegroundSessionImpl: (() => Promise<SessionId | undefined>) | undefined

  /** 当前前台会话；未挂载时返回 undefined。 */
  foregroundAgent(): Agent | undefined {
    return this.foregroundAgentImpl?.()
  }

  /** WeChat `@dsh new` 使用：按 TUI 的 `/new` 逻辑创建会话并切到前台。 */
  async createForegroundSession(): Promise<SessionId | undefined> {
    if (this.createForegroundSessionImpl === undefined) return undefined
    return this.createForegroundSessionImpl()
  }

  constructor(ctx: Context, config: Config) {
    super(ctx, 'tui')

    const startup: TuiStartup = ctx.tuiStartup
    const sessionId = startup.sessionId ?? startup.resumeSessionId
    if (sessionId === undefined) {
      throw new Error('tui: no session identity available')
    }

    const resolved: ResolvedTuiConfig = resolveTuiConfig(config)
    const t: Translator = createTranslator(resolved.locale)
    ctx.effect(() => registerJobsCommand(ctx, t))
    const truecolor = resolved.theme.truecolor || detectTruecolor()
    // Runtime theme state; `/theme` and `/settings` re-paint in place.
    const settings = ctx.settings
    const tuiSettings = settings?.register(TUI_SETTINGS_NAMESPACE, TuiSettingsSchema, {
      base: {
        themeMode: resolved.theme.mode,
        themeDark: resolved.theme.dark,
        themeLight: resolved.theme.light,
        themeSelected: resolved.theme.selected,
      },
    })
    interface ProviderModelProfile {
      id: string
      name?: string
      contextWindow?: number
      maxTokens?: number
    }
    interface ConfiguredProviderProfile {
      apiKeyEnv?: string
      displayName?: string
      api?: string
      baseURL?: string
      models?: ProviderModelProfile[]
    }
    const asRecord = (value: unknown): Record<string, unknown> | undefined => (
      value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : undefined
    )
    const readPath = (value: unknown, path: readonly string[]): unknown => {
      let current = value
      for (const key of path) {
        const record = asRecord(current)
        if (record === undefined) return undefined
        current = record[key]
      }
      return current
    }
    const configurableProviderList = (): LlmConfigurableProvider[] => (
      typeof ctx.llm.listConfigurableProviders === 'function'
        ? ctx.llm.listConfigurableProviders()
        : []
    )
    const readConfiguredProvider = (entry: LlmConfigurableProvider): ConfiguredProviderProfile | undefined => {
      const value = readPath(settings?.get(entry.settingsNs), entry.settingsPath)
      const record = asRecord(value)
      if (record === undefined) return undefined
      const profile: ConfiguredProviderProfile = {}
      if (typeof record.apiKeyEnv === 'string') profile.apiKeyEnv = record.apiKeyEnv
      if (typeof record.displayName === 'string') profile.displayName = record.displayName
      if (typeof record.api === 'string') profile.api = record.api
      if (typeof record.baseURL === 'string') profile.baseURL = record.baseURL
      if (Array.isArray(record.models) && record.models.length > 0) {
        const models = record.models.flatMap(model => {
          if (typeof model === 'string') return [{ id: model }]
          const modelRecord = asRecord(model)
          return typeof modelRecord?.id === 'string'
            ? [{
              id: modelRecord.id,
              ...(typeof modelRecord.name === 'string' ? { name: modelRecord.name } : {}),
              ...(typeof modelRecord.contextWindow === 'number' ? { contextWindow: modelRecord.contextWindow } : {}),
              ...(typeof modelRecord.maxTokens === 'number' ? { maxTokens: modelRecord.maxTokens } : {}),
            }]
            : []
        })
        if (models.length > 0) profile.models = models
      }
      return profile
    }
    const configuredProviderProfiles = (): Readonly<Record<string, ConfiguredProviderProfile>> => {
      const profiles: Record<string, ConfiguredProviderProfile> = {}
      for (const entry of configurableProviderList()) {
        const profile = readConfiguredProvider(entry)
        if (profile !== undefined) profiles[entry.provider] = profile
      }
      return profiles
    }
    // Provider configuration belongs to the adapter that declares it through
    // dsh-llm's configurable-provider directory. The TUI only follows the
    // declared namespace/path and never invents a provider-owned namespace.
    // Runtime theme state; `/theme` and `/settings` repaint in place.

    const migrateLegacyThemeName = (name: string | undefined): Partial<{ themeMode: ThemeMode; themeDark: string; themeLight: string; themeSelected: string }> | undefined => {
      if (name === undefined) return undefined
      const concrete = findTheme(name)
      if (concrete !== undefined) {
        return { themeMode: 'selected', themeDark: resolved.theme.dark, themeLight: resolved.theme.light, themeSelected: name }
      }
      const dark = findTheme(`dark-${name}`)
      const light = findTheme(`light-${name}`)
      if (dark !== undefined && light !== undefined) {
        return { themeMode: 'dynamic', themeDark: dark.id, themeLight: light.id, themeSelected: resolved.theme.selected }
      }

      return undefined
    }
    const persistedTheme = tuiSettings?.get()
    let themeCustom: ThemeCustom | undefined = persistedTheme?.themeCustom ?? resolved.theme.custom
    const legacyThemeMigration = migrateLegacyThemeName(persistedTheme?.themeName)
    let themeMode: ThemeMode = persistedTheme?.themeMode ?? legacyThemeMigration?.themeMode ?? resolved.theme.mode
    let themeDark = persistedTheme?.themeDark ?? legacyThemeMigration?.themeDark ?? resolved.theme.dark
    let themeLight = persistedTheme?.themeLight ?? legacyThemeMigration?.themeLight ?? resolved.theme.light
    let themeSelected = persistedTheme?.themeSelected ?? legacyThemeMigration?.themeSelected ?? resolved.theme.selected
    // Runtime presentation state; `/settings` can persist these through the
    // same TUI settings namespace.
    let showReasoning = persistedTheme?.showReasoning ?? resolved.showReasoning
    let maxToolOutputLines = persistedTheme?.maxToolOutputLines ?? resolved.maxToolOutputLines
    let leftPrompt = persistedTheme?.leftPrompt ?? resolved.theme.leftPrompt
    let rightPrompt = persistedTheme?.rightPrompt ?? resolved.theme.rightPrompt
    let keyTools = persistedTheme?.keyTools ?? 'ctrl+o'
    let keyReasoning = persistedTheme?.keyReasoning ?? 'ctrl+r'
    const resolveDefaultMode = (): string => ctx.agentPresets?.defaultId ?? resolved.mode
    let uiMode: string = resolveDefaultMode()
    // Roster display names (id → name); refreshed from ctx.agentPresets.list().
    const presetNames = new Map<string, string>()
    const permissionCommand = permissionCommandMetadata(ctx.permissionPresets, t)
    const themeOverride = (): ThemeOverride => ({ mode: themeMode, darkId: themeDark, lightId: themeLight, selectedId: themeSelected, custom: themeCustom })
    const palette: Palette = createPalette(resolved.theme.color, 'dark', truecolor, themeOverride())
    const mdTheme = markdownTheme(palette)
    const terminal = new ProcessTerminal()
    // Keep the hardware cursor visible at the editor's real cursor position;
    // IMEs that preview pinyin/composition inline depend on it being shown there.
    // Match Pi's native inline rendering: let content shrink without forcing a
    // viewport-wide clear, so the terminal keeps its normal scrollback flow.
    const ui = new TuiMainScreen(terminal, true)

    // The agent is published asynchronously on the resume path (persistence
    // load), so agent-dependent setup runs in mount() once it is live.
    let agent: Agent | undefined
    let activeAgentGeneration = 0
    let messageSubmissionTail: Promise<void> | undefined
    let gitBranch: string | undefined
    /** Running token usage for the active session; kept incrementally to avoid rescanning the whole log on every status update. */
    let tokenTotals = { inputTokens: 0, outputTokens: 0 }
    // Agent-scoped helpers handed to the command surface by mount().
    const handles: {
      newAgent: (() => Promise<SessionId | undefined>) | undefined
      forkAgent: ((title?: string) => Promise<SessionId | undefined>) | undefined
      switchAgent: ((id: SessionId) => Promise<void>) | undefined
      saveSelection: ((selection: ModelSelection) => Promise<void>) | undefined
      setReasoningEffort: ((effort: NonNullable<ModelSelection['reasoningEffort']>) => Promise<void>) | undefined
      refreshCommands: (() => void) | undefined
      selectionRef: ModelSelectionRef | undefined
    } = {
      newAgent: undefined,
      forkAgent: undefined,
      switchAgent: undefined,
      saveSelection: undefined,
      setReasoningEffort: undefined,
      refreshCommands: undefined,
      selectionRef: undefined,
    }
    // Agent status for a hosting Orca pane. Inert outside Orca, and written
    // straight to stdout so the differential renderer never sees the sequence.
    const orcaStatus = createOrcaStatusReporter({
      write: (data: string) => { terminal.write(data) },
      model: () => handles.selectionRef?.current?.model ?? agent?.options.model,
    })

    let reasoningEffortCache: { route: string; efforts: readonly LlmReasoningEffortInfo[] } | undefined
    const reasoningEffortsFor = async (selection: ModelSelection): Promise<readonly LlmReasoningEffortInfo[]> => {
      const route = `${selection.provider}\u0000${selection.model}`
      if (reasoningEffortCache?.route === route) return reasoningEffortCache.efforts
      const info = await ctx.llm.resolveModelInfo(selection.provider, selection.model)
      const efforts = info.reasoning?.efforts ?? []
      reasoningEffortCache = { route, efforts }
      return efforts
    }

    // --- components -------------------------------------------------------
    const editor = new PromptEditor(ui, {
      borderColor: (text: string) => palette.borderMuted(text),
      selectList: selectTheme(palette),
    } satisfies EditorTheme, {
      paddingX: 1,
    })
    const imagePasteDraft = new ImagePasteDraft({
      maxImages: ctx.attachments.imageLimits.maxImagesPerMessage,
      maxBytes: ctx.attachments.imageLimits.maxMessageImageBytes,
    })
    let imagePasteBusy = false
    let imagePasteDisposed = false
    let leftTemplate = parseTuiPromptTemplate(displayInlineText(persistedTheme?.leftPrompt ?? resolved.theme.leftPrompt))
    let rightTemplate = parseTuiPromptTemplate(displayInlineText(persistedTheme?.rightPrompt ?? resolved.theme.rightPrompt))
    const promptValue = (valueName: string): string | undefined => ctx.tuiPrompt.get(valueName)
    let statusLine = new StatusLineComponent(rightTemplate, promptValue, palette)
    const todoPanel = new TodoPanelComponent(palette)
    const subagentPanel = new SubagentPanelComponent(palette)
    const backgroundJobView = new BackgroundJobViewComponent(palette)
    let navigationOwner: Agent | undefined
    let backgroundJobId: string | undefined
    let openBackgroundSelection: (() => void) | undefined
    let returnToMainAgent: (() => void) | undefined
    const refreshSubagentPanel = (owner: Agent | undefined = agent): void => {
      owner = navigationOwner ?? owner
      if (owner === undefined) {
        subagentPanel.clear()
        return
      }
      subagentPanel.set(liveChildSubagents(ctx.agents.list(), owner.id))
      const jobs = orderJobs(ctx.jobs.list(owner))
      subagentPanel.setJobs(jobs.map(job => ({
        id: String(job.id),
        kind: String(job.kind),
        label: displayInlineText(job.label),
        status: job.status,
        ...(job.detail === undefined ? {} : { detail: displayInlineText(job.detail) }),
        startedAt: job.startedAt,
        ...(job.finishedAt === undefined ? {} : { finishedAt: job.finishedAt }),
      })))
      if (backgroundJobId !== undefined) {
        const job = jobs.find(candidate => String(candidate.id) === backgroundJobId)
        backgroundJobView.set(job === undefined ? undefined : {
          id: String(job.id),
          kind: String(job.kind),
          label: displayInlineText(job.label),
          status: job.status,
          ...(job.detail === undefined ? {} : { detail: displayInlineText(job.detail) }),
          startedAt: job.startedAt,
          ...(job.finishedAt === undefined ? {} : { finishedAt: job.finishedAt }),
        })
      }
    }
    const pendingInputPanel = new PendingInputPanel(palette, mdTheme, t)
    const workingIndicator = new WorkingIndicatorComponent()
    const askSlot = new Container()
    let commandHintText: string | undefined
    const commandHint = new CommandHintComponent(
      () => editor.isShowingAutocomplete() ? undefined : commandHintText,
      palette,
    )
    const inputBorder = new InputBorderComponent(palette)
    let footer = new ComposerFooterComponent(leftTemplate, promptValue, palette)
    let composerMounted = false
    let inlineQuestionDepth = 0
    const askInline = async (
      questions: Parameters<typeof runInlineQuestionFlow>[4],
      signal: Parameters<typeof runInlineQuestionFlow>[5],
    ) => {
      inlineQuestionDepth++
      try {
        return await runInlineQuestionFlow(
          ui,
          askSlot,
          palette,
          t,
          questions,
          signal,
          () => ui.setFocus(editor),
        )
      } finally {
        inlineQuestionDepth--
      }
    }

    // Keep transcript and composer in normal terminal flow. The application
    // does not reserve a fullscreen viewport or pin the composer to the bottom.
    const chat = new TranscriptViewport(() => Number.MAX_SAFE_INTEGER)

    const rebuildChrome = (): void => {
      ui.clear()
      composerMounted = false
      if (backgroundJobId !== undefined) {
        ui.addChild(backgroundJobView)
        ui.addChild(subagentPanel)
        return
      }
      ui.addChild(chat)
      ui.addChild(workingIndicator)
      ui.addChild(todoPanel)
      ui.addChild(pendingInputPanel)
      ui.addChild(statusLine)
      ui.addChild(askSlot)
      ui.addChild(editor)
      ui.addChild(commandHint)
      ui.addChild(inputBorder)
      ui.addChild(footer)
      ui.addChild(subagentPanel)
      composerMounted = true
      ui.setFocus(editor)
    }
    rebuildChrome()
    terminal.setTitle(resolved.title)
    ctx.effect(() => ctx.jobs.onJobsChanged((owner) => {
      if (agent === undefined) return
      if (owner === undefined || owner === agent) {
        refreshSubagentPanel()
        ui.requestRender()
      }
    }))

    // --- prompt values ----------------------------------------------------
    const cwdValue = ctx.tuiPrompt.register('cwd')
    const cwdCompactValue = ctx.tuiPrompt.register('cwd/compact')
    const gitValue = ctx.tuiPrompt.register('git/worktree')
    const gitCompactValue = ctx.tuiPrompt.register('git/worktree/compact')
    const modeValue = ctx.tuiPrompt.register('mode')
    const modeCompactValue = ctx.tuiPrompt.register('mode/compact')
    const modelValue = ctx.tuiPrompt.register('model')
    const modelCompactValue = ctx.tuiPrompt.register('model/compact')
    const effortValue = ctx.tuiPrompt.register('effort')
    const effortCompactValue = ctx.tuiPrompt.register('effort/compact')
    const tokensValue = ctx.tuiPrompt.register('tokens')
    const contextValue = ctx.tuiPrompt.register('context')
    const contextCompactValue = ctx.tuiPrompt.register('context/compact')
    const permissionValue = ctx.tuiPrompt.register('permission')
    const permissionCompactValue = ctx.tuiPrompt.register('permission/compact')
    const queuedValue = ctx.tuiPrompt.register('queued')
    const symbolValue = ctx.tuiPrompt.register('symbol')
    const indicatorValue = ctx.tuiPrompt.register('indicator')

    const updateInputPrompt = (): void => {
      const indicator = ctx.tuiPrompt.get('indicator') ?? ''
      const symbol = ctx.tuiPrompt.get('symbol') ?? ''
      const content = indicator === '' ? symbol : indicator
      const first = content === '' ? '' : `${content} `
      editor.setPrompt({ first, continuation: ' '.repeat(visibleWidth(first)) })
    }

    const refreshPendingInput = (): void => {
      queuedValue.set(pendingInputPanel.count === 0
        ? undefined
        : palette.muted(` ${t('queuedSteer', { count: pendingInputPanel.count })}`))
      ui.requestRender()
    }

    // Transient notices are intentionally suppressed. Durable transcript
    // messages, dialogs, and footer state remain visible at their own seams.
    const appendNotice = (_text: string, _kind: 'info' | 'warning' | 'error'): void => {}

    const warnIfFullAccess = (target: Agent): void => {
      if (ctx.permissionPresets.current(target.session) === FULL_ACCESS_REGISTRY_NAME) {
        appendNotice(t('noticeFullAccessWarning'), 'warning')
      }
    }

    // `--yolo` pins every foreground session to the unrestricted preset
    // through the same write path as `/permission full-access`; re-selecting
    // the effective preset appends nothing.
    const applyStartupPermission = (target: Agent): void => {
      if (!startup.skipPermissions) return
      try {
        ctx.permissionPresets.set(target.session, FULL_ACCESS_REGISTRY_NAME)
      } catch (error: unknown) {
        appendNotice(t('noticeSkipPermissionsFailed', { error: errorChain(error) }), 'error')
      }
    }

    // 微信桥输出不直接写 stderr：日志/二维码作为持久化文本进入 transcript，
    // 与 `/help` 的静态卡片一样保留在终端中，且不会越过差分渲染器覆盖输入框。
    const subscribeWechatOutput = (): void => {
      if (offWechatOutput !== undefined) return
      let bridge: WechatBridge | undefined
      try {
        bridge = ctx.get('wechat') as WechatBridge | undefined
      } catch {
        bridge = undefined
      }
      if (bridge?.subscribeOutput === undefined) return
      offWechatOutput = bridge.subscribeOutput((message) => {
        if (message.kind === 'qr') {
          // 二维码保持无边框等宽文本，避免卡片边框影响扫码。
          chat.addChild(new Spacer(1))
          chat.addChild(new Text(displayText(message.text), 1, 0))
        } else {
          const rows = displayText(message.text)
            .split('\n')
            .map(line => palette.muted(`[dsh-wechat-ilink] ${line}`))
          chat.addChild(new StaticCardComponent(rows, palette))
        }
        ui.requestRender()
      })
    }

    // --- status -----------------------------------------------------------
    let currentScheme: TerminalColorScheme = 'dark'
    let spinnerTimer: NodeJS.Timeout | undefined
    let spinnerIndex = 0
    const workingWords = new WorkingWordRotation()
    let workingWord = 'Working'
    let workingStartedAt = 0
    let isCompacting = false
    let activeRetry: RetryActivity | undefined
    const refreshActivity = (): void => {
      if (isCompacting) {
        indicatorValue.set(undefined)
        workingIndicator.setText(palette.bold(palette.warning(compactingActivityText(
          SPINNER_FRAMES[spinnerIndex] ?? '',
          t('noticeCompacting'),
        ))))
      } else if (activeRetry !== undefined) {
        indicatorValue.set(undefined)
        workingIndicator.setText(palette.bold(palette.warning(compactingActivityText(
          SPINNER_FRAMES[spinnerIndex] ?? '',
          t('noticeRetrying', {
            retry: activeRetry.retry,
            maximum: activeRetry.maximum,
            delay: formatRetryDelay(activeRetry.delayMs),
          }),
        ))))
      } else {
        indicatorValue.set(undefined)
        workingIndicator.setText(spinnerTimer === undefined
          ? undefined
          : `${palette.bold(palette.accent(workingActivityText(SPINNER_FRAMES[spinnerIndex] ?? '', workingWord)))}${palette.muted(` (${formatWorkingElapsed(Date.now() - workingStartedAt)} · ↓ ${formatTokens(tokenTotals.outputTokens)} tokens)`)}`)
      }
      updateInputPrompt()
      ui.requestRender()
    }

    const refreshCompacting = refreshActivity
    let estimatedContextWindow = DEFAULT_CONTEXT_WINDOW
    let contextEstimateRevision = 0

    const startSpinner = (): void => {
      if (spinnerTimer !== undefined) return
      spinnerIndex = 0
      workingWord = workingWords.next()
      workingStartedAt = Date.now()
      spinnerTimer = setInterval(() => {
        spinnerIndex = (spinnerIndex + 1) % SPINNER_FRAMES.length
        refreshActivity()
      }, SPINNER_INTERVAL_MS)
      refreshActivity()
    }

    const stopSpinner = (): void => {
      if (spinnerTimer === undefined) return
      clearInterval(spinnerTimer)
      spinnerTimer = undefined
      refreshActivity()
    }

    /** Expensive status inputs (token meter + permission) are refreshed at most once per second. */
    const CONTEXT_USAGE_REFRESH_MS = 1_000
    let contextUsageCache: { measuredAt: number; totalTokens: number; permission: string } = {
      measuredAt: 0,
      totalTokens: 0,
      permission: '',
    }

    const updateStatusValues = (): void => {
      const current = agent
      if (current === undefined) return
      const cwd = displayText(current.session.header.cwd ?? process.cwd())
      cwdValue.set(palette.path(` ${cwd}`))
      cwdCompactValue.set(palette.path(` ${displayText(basename(cwd))}`))
      gitValue.set(gitBranch === undefined
        ? undefined
        : ` ${palette.statusSep('')} ${palette.git(` ${displayText(gitBranch)}`)}`)
      gitCompactValue.set(gitBranch === undefined
        ? undefined
        : palette.git(` ${displayText(gitBranch)}`))
      const mode = modeLabel(t, uiMode, presetNames)
      const compactMode = visibleWidth(mode) <= visibleWidth(uiMode) ? mode : uiMode
      modeValue.set(`${palette.accent(mode)} ${palette.statusSep('')} `)
      modeCompactValue.set(palette.accent(displayText(compactMode)))
      const selection = handles.selectionRef?.current
      const model = selection?.model ?? current.options.model
      modelValue.set(model === undefined ? undefined : palette.model(displayText(model)))
      modelCompactValue.set(model === undefined ? undefined : palette.model(displayText(model)))
      const effort = selection?.reasoningEffort
      effortValue.set(effort === undefined
        ? undefined
        : ` ${palette.muted('·')} ${palette.accent(displayText(effort))}`)
      effortCompactValue.set(effort === undefined ? undefined : palette.accent(displayText(effort)))
      tokensValue.set(` ${palette.muted('·')} ${palette.spend(`↑${formatTokens(tokenTotals.inputTokens)} ↓${formatTokens(tokenTotals.outputTokens)}`)}`)
      const recordedContext = current.session.requestContext()
      const recordedWindow = recordedContext !== undefined
        && selection !== undefined
        && recordedContext.provider === selection.provider
        && recordedContext.model === selection.model
        ? recordedContext.contextWindow
        : undefined
      const contextWindow = recordedWindow ?? estimatedContextWindow
      const now = Date.now()
      if (now - contextUsageCache.measuredAt >= CONTEXT_USAGE_REFRESH_MS) {
        let totalTokens = 0
        try {
          totalTokens = ctx.tokenMeter.measure(current.session).totalTokens
        } catch {
          // Before assembly, some providers cannot estimate the input. Show the
          // required zero fallback rather than hiding the context segment.
        }
        contextUsageCache = {
          measuredAt: now,
          totalTokens,
          permission: ctx.permissionPresets.current(current.session),
        }
      }
      const contextText = `ctx ${formatContextTokens(contextUsageCache.totalTokens)}/${formatContextTokens(contextWindow)}`
      contextValue.set(` ${palette.muted('·')} ${palette.context(contextText)}`)
      contextCompactValue.set(palette.context(contextText))
      const permission = contextUsageCache.permission
      const permissionRole = permission === FULL_ACCESS_REGISTRY_NAME
        ? (text: string) => palette.bold(palette.accent(text))
        : permission === 'read-only' ? palette.muted : palette.accent
      const permissionText = permissionRole(displayText(displayPermissionName(permission)))
      permissionValue.set(` ${palette.muted('·')} ${permissionText}`)
      permissionCompactValue.set(permissionText)
      queuedValue.set(pendingInputPanel.count === 0
        ? undefined
        : palette.muted(` ${t('queuedSteer', { count: pendingInputPanel.count })}`))
      symbolValue.set('')
      updateInputPrompt()
    }

    const refreshGitBranch = (workspace: string): void => {
      const target = agent
      gitBranch = undefined
      void readGitBranch(workspace).then(branch => {
        if (agent !== target) return
        gitBranch = branch
        updateStatusValues()
        ui.requestRender()
      })
    }

    const refreshContextEstimate = (target: Agent, selection: ModelSelection): void => {
      const revision = ++contextEstimateRevision
      const recorded = target.session.requestContext()
      const recordedWindow = recorded !== undefined
        && recorded.provider === selection.provider
        && recorded.model === selection.model
        ? recorded.contextWindow
        : undefined
      estimatedContextWindow = recordedWindow ?? DEFAULT_CONTEXT_WINDOW
      if (target.id === agent?.id) {
        updateStatusValues()
        ui.requestRender()
      }
      if (recordedWindow !== undefined) return
      void ctx.llm.resolveModelInfo(selection.provider, selection.model).then((info) => {
        if (revision !== contextEstimateRevision || target.id !== agent?.id) return
        estimatedContextWindow = info.context?.contextWindow ?? DEFAULT_CONTEXT_WINDOW
        updateStatusValues()
        ui.requestRender()
      }).catch(() => {
        // The 1m fallback remains visible when exact model metadata is unavailable.
      })
    }

    const setStatus = (status: AgentStatus): void => {
      editor.borderColor = status === 'running'
        ? (text: string) => palette.accent(text)
        : (text: string) => palette.borderMuted(text)
      if (status === 'running') startSpinner()
      else stopSpinner()
      terminal.setProgress(status === 'running')
      updateStatusValues()
      ui.requestRender()
    }

    // --- transcript ---------------------------------------------------------
    const assistantStream = new AssistantStreamController(chat, palette, mdTheme)
    const toolCards = new Map<ToolCallId, ToolCardComponent>()
    const toolArguments = new Map<ToolCallId, unknown>()
    const toolNames = new Map<ToolCallId, string>()
    const presentCall = (name: string, args: unknown): ToolCallView | undefined => {
      try {
        return (ctx.tools.get(name, agent) ?? ctx.tools.get(name))?.presentCall?.(args)
      } catch {
        return undefined
      }
    }
    const presentResult = (name: string, args: unknown, result: ToolResult): ToolResultView | undefined => {
      try {
        return (ctx.tools.get(name, agent) ?? ctx.tools.get(name))?.presentResult?.(args, result)
      } catch {
        return undefined
      }
    }
    const parseToolArguments = (value: string): unknown => {
      try {
        return JSON.parse(value)
      } catch {
        return undefined
      }
    }
    const allToolCards = new Set<{ setVisibility(visibility: ToolCardVisibility): void }>()
    /** `hook/invoked` payloads awaiting their paired `hook/result` (by handlerId). */
    const hookInvocations = new Map<string, { point: string; matcher?: string }>()
    let toolsVisibility: ToolCardVisibility = 'collapsed'
    let live = false
    let header: HeaderComponent | undefined
    let transcriptStart = 0
    /** Idle submissions already painted while awaiting their durable user/message event. */
    const immediateUserMessages = new Map<string, Component>()
    /** Completed shell cards awaiting replacement by their durable user/message projection. */
    const immediateShellMessages = new Map<string, Component>()
    const appendShellCard = (shell: string, command: string, result?: ShellCommandResult): {
      card: ToolCardComponent
      wrapper: Container
    } => {
      const wrapper = new Container()
      wrapper.addChild(new Spacer(1))
      const card = registerVisibilityCard(
        allToolCards,
        new ToolCardComponent(shell, JSON.stringify({ command }), maxToolOutputLines, palette),
        toolsVisibility,
      )
      if (result !== undefined) {
        card.updateDispatch(
          [{ type: 'text', text: renderShellResultText(result) }],
          shellResultFailed(result),
        )
      }
      wrapper.addChild(card)
      chat.addChild(wrapper)
      return { card, wrapper }
    }
    /** Invalidates chunked rebuilds that are superseded by a newer window. */
    let transcriptBuildGeneration = 0
    const renderEvent = (
      event: SessionEvent,
      syncStatus = true,
      notify = true,
      updateSessionView = true,
    ): void => {
      switch (event.type) {
        case 'user/message': {
          if (pendingInputPanel.remove(event.data.id)) refreshPendingInput()
          const source = event.data.source
          const rawText = contentText(event.data.content).trim()
          const shellResult = source.kind === 'user' ? parseShellUserMessage(rawText) : undefined
          if (shellResult !== undefined) {
            if (immediateShellMessages.delete(event.data.id)) break
            appendShellCard(shellResult.shell, shellResult.command, shellResult)
            break
          }
          const text = displayText(rawText)
          if (text === '') break
          // Idle submissions are painted before steer() so the input feels
          // immediate. Their durable event confirms that existing component.
          if (source.kind === 'user' && immediateUserMessages.delete(event.data.id)) break
          chat.addChild(new Spacer(1))
          if (source.kind !== 'user') {
            const label = source.kind === 'plugin' ? source.plugin : source.kind
            const card = registerVisibilityCard(
              allToolCards,
              new ContextCardComponent(label, text, maxToolOutputLines, palette),
              toolsVisibility,
            )
            chat.addChild(card)
          } else {
            chat.addChild(new UserMessageComponent(text, palette, mdTheme))
          }
          break
        }
        case 'step/start':
          assistantStream.start(showReasoning)
          break
        case 'llm/retry':
          if (live) {
            activeRetry = retryActivity(event.data)
            refreshActivity()
          }
          break
        case 'llm/retry-started':
          if (live) {
            activeRetry = undefined
            refreshActivity()
          }
          break
        case 'assistant/chunk':
          activeRetry = undefined
          assistantStream.update(event.data.chunk)
          break
        case 'assistant/message':
          assistantStream.settle(event.data.message.content)
          if (updateSessionView && event.data.usage !== undefined) {
            tokenTotals.inputTokens += event.data.usage.inputTokens
            tokenTotals.outputTokens += event.data.usage.outputTokens
          }
          break
        case 'step/end':
          activeRetry = undefined
          assistantStream.end()
          break
        case 'tool/call': {
          const args = parseToolArguments(event.data.arguments)
          const card = new ToolCardComponent(
            event.data.name,
            event.data.arguments,
            maxToolOutputLines,
            palette,
            presentCall(event.data.name, args),
          )
          registerVisibilityCard(allToolCards, card, toolsVisibility)
          toolCards.set(event.data.callId, card)
          toolArguments.set(event.data.callId, args)
          toolNames.set(event.data.callId, event.data.name)
          chat.addChild(card)
          break
        }
        case 'tool/result': {
          const callId = event.data.message.content[0]?.toolCallId
          const card = callId === undefined ? undefined : toolCards.get(callId)
          if (callId !== undefined && card !== undefined) {
            const block = event.data.message.content[0]
            const args = toolArguments.get(callId)
            const name = toolNames.get(callId) ?? 'unknown'
            card.updateResult(event.data, presentResult(name, args, {
              content: block.content,
              isError: block.isError === true,
              ...(event.data.meta === undefined ? {} : { meta: event.data.meta }),
            }))
          }
          break
        }
        case 'tool/code-dispatch-start': {
          const args = event.data.arguments
          const card = new ToolCardComponent(
            event.data.name,
            JSON.stringify(args),
            maxToolOutputLines,
            palette,
            presentCall(event.data.name, args),
          )
          registerVisibilityCard(allToolCards, card, toolsVisibility)
          toolCards.set(event.data.subCallId, card)
          toolArguments.set(event.data.subCallId, args)
          toolNames.set(event.data.subCallId, event.data.name)
          const parent = toolCards.get(event.data.parentCallId)
          if (parent === undefined) chat.addChild(card)
          else parent.addSubCall(card)
          break
        }
        case 'tool/code-dispatch': {
          const args = event.data.arguments
          let card = toolCards.get(event.data.subCallId)
          if (card === undefined) {
            card = new ToolCardComponent(
              event.data.name,
              JSON.stringify(args),
              maxToolOutputLines,
              palette,
              presentCall(event.data.name, args),
            )
            registerVisibilityCard(allToolCards, card, toolsVisibility)
            toolCards.set(event.data.subCallId, card)
            toolNames.set(event.data.subCallId, event.data.name)
            toolArguments.set(event.data.subCallId, args)
            const parent = toolCards.get(event.data.parentCallId)
            if (parent === undefined) chat.addChild(card)
            else parent.addSubCall(card)
          }
          card.updateDispatch(event.data.content, event.data.isError, presentResult(
            event.data.name,
            args,
            { content: event.data.content, isError: event.data.isError },
          ))
          break
        }
        case 'todo/write':
          if (updateSessionView) todoPanel.setTodos(event.data.todos)
          break
        case 'goal/change':
          if (updateSessionView) {
            if (event.data.operation === 'clear') {
              todoPanel.setGoal(undefined)
            } else {
              todoPanel.setGoal({ objective: event.data.goal.objective, phase: event.data.goal.phase })
            }
          }
          break
        case 'hook/invoked':
          hookInvocations.set(event.data.handlerId, event.data)
          break
        case 'hook/result': {
          const invoked = hookInvocations.get(event.data.handlerId)
          hookInvocations.delete(event.data.handlerId)
          const blocked = event.data.decision === 'deny'
            || event.data.decision === 'block'
            || event.data.decision === 'stop'
          // An uneventful pass-through (no blocking decision, clean exit, no
          // stderr) stays in the durable log but adds nothing to the screen.
          const notable = blocked
            || event.data.decision === 'ask'
            || (event.data.exitCode !== undefined && event.data.exitCode !== 0)
            || event.data.stderrSummary !== undefined
          if (!notable) break
          const outcome = `${event.data.decision}`
            + (event.data.exitCode === undefined ? '' : ` · exit ${event.data.exitCode}`)
            + ` · ${Math.round(event.data.durationMs)}ms`
          const detail = [
            outcome,
            ...invoked?.matcher === undefined ? [] : [`matcher: ${invoked.matcher}`],
            ...event.data.stderrSummary === undefined ? [] : event.data.stderrSummary.split('\n'),
          ].join('\n')
          const card = registerVisibilityCard(
            allToolCards,
            new ContextCardComponent(event.data.point, detail, maxToolOutputLines, palette, 'Hook'),
            toolsVisibility,
          )
          chat.addChild(new Spacer(1))
          chat.addChild(card)
          if (live && notify && blocked) {
            appendNotice(t('noticeHookBlocked', {
              point: event.data.point,
              decision: event.data.decision,
            }), 'warning')
          }
          break
        }
        case 'compaction/start':
          if (updateSessionView) {
            isCompacting = true
            startSpinner()
          }
          break
        case 'compaction/end':
          if (!updateSessionView) break
          isCompacting = false
          refreshCompacting()
          // Force token counts to re-measure: the compressed history is
          // dramatically smaller than the shadowed range.
          contextUsageCache.measuredAt = 0
          if (live && notify) {
            appendNotice(
              event.data.error === undefined ? t('noticeCompactionDone') : t('noticeCompactionFailed', { error: event.data.error }),
              event.data.error === undefined ? 'info' : 'error',
            )
          }
          break
        case 'turn/end': {
          if (live && notify && agent !== undefined) {
            pendingInputPanel.sync([...agent.inbox.nextStep, ...agent.inbox.nextTurn])
            refreshPendingInput()
          }
          // Detach the live streaming slot so straggler chunks that arrive
          // after an abort cannot keep appending to the interrupted step;
          // its rendered partial content stays in the transcript.
          activeRetry = undefined
          assistantStream.end()
          const reason = event.data.reason
          if (reason.kind === 'error') {
            const text = t('noticeTurnFailed', {
              code: displayErrorCode(reason.error.code),
              attempt: requestAttemptForTurn(agent?.session.snapshotEvents() ?? [event], event.data.turn),
              error: reason.error.message,
            })
            chat.addChild(new ErrorMessageComponent(
              displayText(text).split('\n').map(row => palette.error(row)),
              palette,
            ))
          } else if (live && notify && reason.kind !== 'completed') {
            appendNotice(t('noticeTurnEnded', { reason: reason.kind }), 'warning')
          }
          break
        }
        default:
          break
      }
      if (updateSessionView) {
        const descriptor = sessionSubagent(event)
        if (descriptor !== undefined) subagentPanel.add(descriptor)
      }
      if (syncStatus) updateStatusValues()
    }

    /**
     * Rebuild the transcript from `start` to the end. `anchor` controls the
     * viewport after the rebuild: `'bottom'` follows the latest event, while
     * `'top'` keeps the newly prepended page in view (for paging backwards).
     */
    const renderTranscriptWindow = (start: number, anchor: 'bottom' | 'top' = 'bottom'): void => {
      assistantStream.end()
      toolCards.clear()
      allToolCards.clear()
      hookInvocations.clear()
      chat.followLatest = anchor === 'bottom'
      chat.lineOffset = 0
      immediateUserMessages.clear()
      immediateShellMessages.clear()
      chat.clear()
      if (header !== undefined) chat.addChild(header)
      chat.addChild(new TranscriptFoldNoticeComponent(() => transcriptStart, palette))
      const events = agent!.session.snapshotEvents()
      const generation = ++transcriptBuildGeneration
      let index = Math.max(0, start)
      const chunkSize = 200
      const renderChunk = (): void => {
        // Drop stale work if a newer window build started or the active
        // session changed while this chunked rebuild was still running.
        if (generation !== transcriptBuildGeneration) return
        if (agent === undefined || agent.session.snapshotEvents() !== events) return
        const end = Math.min(index + chunkSize, events.length)
        for (; index < end; index++) {
          renderEvent(events[index]!, false, false, false)
        }
        if (index < events.length) {
          setImmediate(renderChunk)
          ui.requestRender()
        } else {
          updateStatusValues()
          ui.requestRender()
        }
      }
      renderChunk()
    }

    const rebuildTranscript = (): void => {
      const events = agent!.session.snapshotEvents()
      const view = foldSessionView(events)
      todoPanel.setTodos(view.todos)
      todoPanel.setGoal(view.goal)
      tokenTotals = { ...view.tokenTotals }
      refreshSubagentPanel()
      contextUsageCache.measuredAt = 0
      // Re-derive persistent compacting flag when rebuilding a truncated window.
      isCompacting = false
      for (const event of events) {
        if (event.type === 'compaction/start') isCompacting = true
        else if (event.type === 'compaction/end') isCompacting = false
      }
      refreshCompacting()
      transcriptStart = recentTranscriptStart(events.length)
      renderTranscriptWindow(transcriptStart, 'bottom')
    }

    let previewThemeId: string | undefined
    const repaintTheme = (selectedPreview?: string, rebuild = false): void => {
      const override = selectedPreview === undefined
        ? themeOverride()
        : { ...themeOverride(), mode: 'selected' as const, selectedId: selectedPreview }
      Object.assign(palette, createPalette(resolved.theme.color, currentScheme, truecolor, override))
      Object.assign(mdTheme, markdownTheme(palette))
      if (rebuild) rebuildTranscript()
      setStatus(agent?.status ?? 'idle')
      if (rebuild) {
        ui.requestRender()
      } else {
        // Theme preview recolors nearly every row. Reset the visible viewport so
        // main-screen scrollback cannot leave an old composer/footer in view.
        redrawThemePreview(terminal, ui)
      }
    }
    const previewTheme = (id: string): void => {
      if (previewThemeId === id || findTheme(id) === undefined) return
      previewThemeId = id
      repaintTheme(id)
    }
    const clearThemePreview = (): void => {
      if (previewThemeId === undefined) return
      previewThemeId = undefined
      repaintTheme()
    }

    const loadOlderTranscript = (): void => {
      if (transcriptStart <= 0) return
      transcriptStart = Math.max(0, transcriptStart - TRANSCRIPT_LOAD_EVENT_STEP)
      renderTranscriptWindow(transcriptStart, 'top')
    }

    /** Scroll the transcript by a signed number of lines; loading older pages at the top. */
    const scrollTranscriptLines = (delta: number): void => {
      if (delta < 0) {
        if (chat.followLatest) {
          chat.lineOffset = Math.max(0, chat.lastTotalLines - chat.lastViewportLines)
          chat.followLatest = false
        }
        chat.lineOffset = Math.max(0, chat.lineOffset + delta)
        if (chat.lineOffset === 0 && transcriptStart > 0) {
          loadOlderTranscript()
          return
        }
      } else if (delta > 0 && !chat.followLatest) {
        const maxOffset = Math.max(0, chat.lastTotalLines - chat.lastViewportLines)
        chat.lineOffset = Math.min(maxOffset, chat.lineOffset + delta)
        if (chat.lineOffset >= maxOffset) chat.followLatest = true
      }
      ui.requestRender()
    }

    /** Scroll the transcript by one viewport page; loading older pages at the top. */
    const scrollTranscriptPage = (direction: -1 | 1): void => {
      scrollTranscriptLines(direction * Math.max(1, chat.lastViewportLines))
    }

    const latestCompactionError = (): string | undefined => {
      const events = agent?.session.snapshotEvents()
      if (events === undefined) return undefined
      for (let index = events.length - 1; index >= 0; index--) {
        const event = events[index]!
        if (event.type === 'compaction/end') {
          const error = (event.data as { error?: string }).error
          return typeof error === 'string' && error !== '' ? error : undefined
        }
      }
      return undefined
    }

    // --- input ---------------------------------------------------------------
    const toggleTools = (): void => {
      toolsVisibility = nextToolCardVisibility(toolsVisibility)
      applyCardVisibility(allToolCards, toolsVisibility)
      appendNotice(t('noticeToolCards', { visibility: toolsVisibility }), 'info')
    }

    const recordActivePreset = (target: Agent): void => {
      const mounted = ctx.agentPresets?.composedPreset(target.ctx)
      const recorded = ctx.sessionProjections.stateOf(target.session, 'agentPreset') ?? undefined
      const preset = mounted ?? recorded
        ?? (target.id === agent?.id ? uiMode : undefined)
      if (preset !== undefined) recordConversationPreset(target.session, preset, recorded)
    }

    const toggleReasoning = (): void => {
      showReasoning = !showReasoning
      appendNotice(showReasoning ? t('noticeReasoningShown') : t('noticeReasoningHidden'), 'info')
    }

    const attachPastedImage = async (load: () => ReturnType<typeof readClipboardImage>): Promise<void> => {
      const target = agent
      if (imagePasteBusy || target === undefined) return
      const generation = activeAgentGeneration
      imagePasteBusy = true
      try {
        const image = await load()
        if (image === null) {
          appendNotice(t('noticeImagePasteEmpty'), 'warning')
          return
        }
        await ctx.attachments.validateImage(image)
        if (imagePasteDisposed || agent !== target || activeAgentGeneration !== generation) return
        const marker = imagePasteDraft.add(image)
        editor.insertTextAtCursor(marker)
      } catch (error: unknown) {
        appendNotice(t('noticeImagePasteFailed', { error: errorChain(error) }), 'warning')
      } finally {
        imagePasteBusy = false
      }
    }

    const pasteClipboardImage = async (): Promise<void> => {
      await attachPastedImage(async () => await readClipboardImage({
        maxBytes: ctx.attachments.imageLimits.maxImageBytes,
        mediaTypes: ctx.attachments.imageLimits.mediaTypes,
      }))
    }

    const pasteImageFile = async (filePath: string): Promise<void> => {
      await attachPastedImage(async () => await readPastedImageFile(
        filePath,
        ctx.attachments.imageLimits.maxImageBytes,
        ctx.attachments.imageLimits.mediaTypes,
      ))
    }

    const runCommand = async (
      line: string,
      images: readonly EncodedImageAttachment[] = [],
      onImageRejected?: () => void,
    ): Promise<void> => {
      const current = agent
      if (current === undefined) return
      if (line === '/palette' || line.startsWith('/palette ')) {
        const rows = renderPalette(palette, currentScheme, resolved.theme.color, truecolor, themeOverride())
        chat.addChild(new StaticCardComponent(rows, palette))
        ui.requestRender()
        return
      }
      if (line === '/context' || line.startsWith('/context ')) {
        try {
          const measurement = ctx.tokenMeter.measure(current.session)
          const selection = handles.selectionRef?.current
          const model = selection?.model ?? current.session.requestHeader()?.config.model ?? 'model'
          let capacity = estimatedContextWindow
          if (selection !== undefined) {
            const info = await ctx.llm.resolveModelInfo(selection.provider, selection.model)
            capacity = info.context?.contextWindow ?? capacity
          }
          const snapshot = buildContextUsageSnapshot(
            current.session.snapshotEvents(),
            measurement.nodes,
            measurement.totalTokens,
            capacity,
            model,
          )
          const screen = new ContextUsageScreen(snapshot, palette, t, terminal.rows)
          composerMounted = false
          ui.clear()
          ui.addChild(screen)
          ui.setFocus(screen)
          ui.requestRender()
          await new Promise<void>((resolve) => { screen.onClose = resolve })
          rebuildChrome()
          ui.requestRender()
        } catch (error: unknown) {
          rebuildChrome()
          appendNotice(t('noticeEventRenderFailed', { error: errorChain(error) }), 'error')
        }
        return
      }
      // The TUI presents the unrestricted preset as `full-access`; the host
      // registry still knows it as `danger-full-access`, so translate before
      // handing the slash command to the backend.
      const permissionMatch = /^\/permission(?:\s+(.*))?$/.exec(line)
      if (permissionMatch !== null) {
        const arg = permissionMatch[1]?.trim() ?? ''
        line = arg === '' ? '/permission' : `/permission ${registryPermissionName(arg)}`
      }
      if (line === '/model' || line.startsWith('/model ')) {
        const save = handles.saveSelection
        if (save === undefined) return
        try {
          await runModelFlow(ui, palette, t, ctx.llm, save)
        } catch (error: unknown) {
          appendNotice(t('noticeModelFailed', { error: errorChain(error) }), 'error')
        }
        ui.requestRender()
        return
      }
      if (line === '/think' || line.startsWith('/think ')) {
        const selection = handles.selectionRef?.current
        const setEffort = handles.setReasoningEffort
        if (selection === undefined || setEffort === undefined) return
        try {
          const efforts = await reasoningEffortsFor(selection)
          const choice = chooseReasoningEffort(
            efforts,
            selection.reasoningEffort,
            line.slice('/think'.length).trim(),
          )
          if (choice.kind === 'unsupported') {
            appendNotice(t('noticeThinkUnsupported'), 'warning')
            return
          }
          if (choice.kind === 'unknown') {
            appendNotice(t('noticeThinkUnknown', { name: choice.requested }), 'warning')
            return
          }
          const params = { name: displayText(choice.effort.name), id: displayText(choice.effort.id) }
          if (choice.kind === 'already') {
            appendNotice(t('noticeThinkAlready', params), 'info')
            return
          }
          await setEffort(choice.effort.id)
          appendNotice(t('noticeThinkSet', params), 'info')
        } catch (error: unknown) {
          appendNotice(t('noticeThinkFailed', { error: errorChain(error) }), 'error')
        }
        return
      }
      if (line === '/reload' || line.startsWith('/reload ')) {
        if (current.status === 'running' || isCompacting) {
          appendNotice(t('noticeReloadBusy'), 'warning')
          return
        }
        // The respawn supervisor names the handoff file; without it a reload
        // exit would simply terminate the process, so refuse instead.
        const handoffPath = process.env[RELOAD_HANDOFF_ENV]
        const exit = ctx.appExit
        if (handoffPath === undefined || handoffPath === '' || exit === undefined) {
          appendNotice(t('noticeReloadUnsupervised'), 'warning')
          return
        }
        try {
          // A blank session was never materialized by the persistence gate, so
          // agent-loop's strict config resume would fail; recreate its exact id
          // fresh instead.
          writeReloadHandoff(handoffPath, {
            args: nextGenerationArgs(
              ctx.get('cmdlineArgs')?.get() ?? [],
              String(current.session.header.id),
              hasConversationData(current.session.snapshotEvents()) ? '--resume' : '--session',
            ),
          })
        } catch (error: unknown) {
          appendNotice(t('noticeReloadFailed', { error: errorChain(error) }), 'error')
          return
        }
        appendNotice(t('noticeReloading'), 'info')
        exit(RELOAD_EXIT_CODE)
        armExitWatchdog(RELOAD_EXIT_CODE)
        return
      }
      if (line === '/new' || line.startsWith('/new ')) {
        const creator = handles.newAgent
        if (creator === undefined) return
        appendNotice(t('noticeCreatingSession'), 'info')
        try {
          await creator()
        } catch (error: unknown) {
          appendNotice(t('noticeSessionCreateFailed', { error: errorChain(error) }), 'error')
        }
        return
      }
      if (line === '/fork' || line.startsWith('/fork ')) {
        const forker = handles.forkAgent
        if (forker === undefined) return
        if (current.status === 'running' || isCompacting) {
          appendNotice(t('noticeForkBusy'), 'warning')
          return
        }
        const title = line.slice('/fork'.length).trim() || undefined
        try {
          await forker(title)
        } catch (error: unknown) {
          appendNotice(t('noticeSessionForkFailed', { error: errorChain(error) }), 'error')
        }
        return
      }
      if (line === '/rename' || line.startsWith('/rename ')) {
        const existingTitle = foldSessionTitle(current.session.snapshotEvents())?.title ?? ''
        let title = line.slice('/rename'.length).trim()
        if (title === '') {
          const picked = await showOverlay<string>(
            ui,
            done => new InputDialog(t('renameTitle'), palette, done, t, existingTitle),
          )
          if (picked === undefined) return
          title = picked
        }
        try {
          const renamed = ctx.sessionTitle.rename(current.session, title)
          appendNotice(t('noticeSessionRenamed', { title: renamed.title }), 'info')
          ui.requestRender()
        } catch (error: unknown) {
          appendNotice(t('noticeSessionRenameFailed', { error: errorChain(error) }), 'error')
        }
        return
      }
      if (line === '/resume' || line.startsWith('/resume ')) {
        const switcher = handles.switchAgent
        if (switcher === undefined) return
        const explicit = line.slice('/resume'.length).trim()
        if (explicit !== '') {
          try {
            const workspace = current.session.header.cwd ?? process.cwd()
            const persisted = filterResumeSessions(
              await ctx.sessionQuery.listSessions(),
              workspace,
              current.session.id,
            )
            const exactId = persisted.find(record => String(record.header.id) === explicit)
            if (exactId !== undefined) {
              await switcher(exactId.header.id)
              return
            }
            const observations = await ctx.sessionQuery.readTitleSnapshots(
              persisted.map(record => record.header.id),
            )
            const titleById = new Map<string, string>()
            for (const observation of observations) {
              if (observation.status === 'fulfilled' && observation.value.title !== undefined) {
                titleById.set(String(observation.sessionId), observation.value.title.title)
              }
            }
            const resolvedTarget = resolveSessionSelector(
              persisted.map(record => ({ record, title: titleById.get(String(record.header.id)) })),
              explicit,
            )
            if (resolvedTarget.kind === 'found') {
              await switcher(resolvedTarget.id)
            } else if (resolvedTarget.kind === 'ambiguous') {
              appendNotice(t('noticeSessionSelectorAmbiguous', { name: explicit }), 'warning')
            } else {
              appendNotice(t('noticeSessionSelectorNotFound', { name: explicit }), 'warning')
            }
          } catch (error: unknown) {
            appendNotice(t('noticeSessionListFailed', { error: errorChain(error) }), 'error')
          }
          return
        }
        try {
          const records = await ctx.sessionQuery.listSessions()
          const workspace = current.session.header.cwd ?? process.cwd()
          const persisted = filterResumeSessions(records, workspace, current.session.id)
            .sort((left, right) => (right.header.createdAt ?? 0) - (left.header.createdAt ?? 0))
            .slice(0, RESUME_PICKER_LIMIT)
          if (persisted.length === 0) {
            appendNotice(t('noticeNoSessions'), 'warning')
            return
          }
          const titlesPromise = ctx.sessionQuery.readTitleSnapshots(
            persisted.map(record => record.header.id),
          ).catch(() => [] as Awaited<ReturnType<typeof ctx.sessionQuery.readTitleSnapshots>>)
          let titleTimer: NodeJS.Timeout | undefined
          const timeoutPromise = new Promise<Awaited<ReturnType<typeof ctx.sessionQuery.readTitleSnapshots>>>(
            resolve => { titleTimer = setTimeout(() => resolve([]), RESUME_TITLES_TIMEOUT_MS) },
          )
          // Titles are decorative; if a slow/corrupt session blocks the batch,
          // show the picker after the timeout with untitled labels instead of freezing.
          const titles = await Promise.race([titlesPromise, timeoutPromise])
          clearTimeout(titleTimer)
          const titleById = new Map<string, string | undefined>()
          for (const observation of titles) {
            if (observation.status === 'fulfilled') {
              titleById.set(String(observation.sessionId), observation.value.title?.title)
            }
          }
          const picked = await showOverlay<string>(ui, (done) => new SelectDialog(
            t('resumeTitle'),
            persisted.map(record => ({
              value: String(record.header.id),
              label: titleById.get(String(record.header.id)) ?? t('untitled'),
              description: `${record.header.id} · ${new Date(record.header.createdAt ?? 0).toLocaleString()}`,
            })),
            palette,
            done,
          ))
          if (picked !== undefined) await switcher(SessionId(picked))
        } catch (error: unknown) {
          appendNotice(t('noticeSessionListFailed', { error: errorChain(error) }), 'error')
        }
        return
      }
      if (line === '/skills' || line.startsWith('/skills ')) {
        try {
          const snapshot = await ctx.skills.snapshot({
            cwd: current.session.header.cwd ?? process.cwd(),
            scope: scopeOf(current.ctx),
          })
          const skills = snapshot.skills.filter(isUserInvocable)
          if (skills.length === 0) {
            appendNotice(t('noticeNoSkills'), 'info')
            return
          }
          const rows = skills.map(skill =>
            `/skill:${skill.name} — ${skill.description}${skill.source === undefined ? '' : ` (${skill.source})`}`)
          chat.addChild(new StaticCardComponent(rows, palette))
          ui.requestRender()
        } catch (error: unknown) {
          appendNotice(t('noticeSkillListFailed', { error: errorChain(error) }), 'error')
        }
        return
      }
      if (line.startsWith('/skill:')) {
        const { name, request } = parseSkillInvocation(line)
        if (name === '') {
          appendNotice(t('noticeSkillUsage'), 'warning')
          return
        }
        try {
          const definition = await ctx.skills.get(name, {
            cwd: current.session.header.cwd ?? process.cwd(),
            scope: scopeOf(current.ctx),
          })
          if (definition === undefined || !isUserInvocable(definition)) {
            appendNotice(t('noticeUnknownSkill', { name }), 'warning')
            return
          }
          recordActivePreset(current)
          const instructions = createUserMessage({
            content: [{ type: 'text', text: renderSkillContent(definition) }],
            source: { kind: 'skill-invocation', name, form: 'instructions' },
          })
          if (request === '') {
            current.steer(instructions)
          } else {
            // Queue the skill context without waking, then use the trailing text
            // as the visible user request that wakes the same nearest step.
            current.inject(instructions)
            current.steer(createUserMessage({
              content: [{ type: 'text', text: request }],
              source: { kind: 'user' },
            }))
          }
        } catch (error: unknown) {
          appendNotice(t('noticeSkillFailed', { name, error: errorChain(error) }), 'error')
        }
        return
      }
      if (line === '/copy' || line.startsWith('/copy ')) {
        const text = latestAssistantText(current.session.snapshotEvents())
        if (text === undefined) {
          appendNotice(t('noticeCopyEmpty'), 'warning')
        } else {
          terminal.write(osc52ClipboardSequence(text))
          appendNotice(t('noticeCopySuccess'), 'info')
        }
        return
      }
      if (line === '/details' || line.startsWith('/details ')) {
        const folded = foldSessionTitle(current.session.snapshotEvents())
        const model = handles.selectionRef?.current?.model ?? current.options.model
        let inputTokens = 0
        let outputTokens = 0
        for (const event of current.session.snapshotEvents()) {
          if (event.type === 'assistant/message' && event.data.usage !== undefined) {
            inputTokens += event.data.usage.inputTokens
            outputTokens += event.data.usage.outputTokens
          }
        }
        const contextWindow = current.session.requestContext()?.contextWindow
        const usedTokens = ctx.tokenMeter.measure(current.session).totalTokens
        const rows: Array<[string, string]> = [
          ['Title', folded?.title ?? 'untitled'],
          ['Session', String(current.session.id)],
          ['Directory', current.session.header.cwd ?? process.cwd()],
          ['Model', `${current.options.provider ?? '?'}/${model ?? '?'}`],
          ['Agent', `${current.id} · ${current.status}`],
          ['Tokens', `↑${formatTokens(inputTokens)} ↓${formatTokens(outputTokens)}`],
          ['Context', contextWindow === undefined
            ? `${formatTokens(usedTokens)} used · capacity unknown`
            : `${Math.round(usedTokens / contextWindow * 100)}% · ${formatTokens(usedTokens)} / ${formatTokens(contextWindow)}`],
        ]
        const labelWidth = Math.max(...rows.map(([label]) => label.length))
        const body = rows.map(([label, value]) =>
          ` ${palette.dim(String(label).padEnd(labelWidth))}  ${displayText(String(value))}`)
        chat.addChild(new StaticCardComponent(body, palette))
        ui.requestRender()
        return
      }
      if (line === '/mode' || line.startsWith('/mode ')) {
        const presets = ctx.agentPresets
        if (presets === undefined) {
          appendNotice(t('noticeModeUnavailable'), 'warning')
          return
        }
        const roster = (await presets.list()).filter(preset => preset.broken === undefined)
        // The official roster owns both the accepted ids and cycle order.
        const known = roster.map(preset => preset.id)
        if (known.length === 0) {
          appendNotice(t('noticeModeUnavailable'), 'warning')
          return
        }
        const arg = line.slice('/mode'.length).trim()
        if (arg !== '' && !known.includes(arg)) {
          appendNotice(t('noticeModeUnknown', { name: arg }), 'warning')
          return
        }
        const live = presets.composedPreset(current.ctx)
        const currentMode = live ?? uiMode
        const liveIndex = known.indexOf(currentMode)
        const target = arg === ''
          ? known[(liveIndex + 1) % known.length] ?? currentMode
          : arg
        if (currentMode === target) {
          appendNotice(t('noticeModeAlready', { mode: modeLabel(t, target, presetNames) }), 'info')
          return
        }
        // Swapping the composition mid-conversation would leave logged tool
        // calls the new preset cannot make; the official roster only allows
        // switching while the session is blank.
        const produced = hasConversationData(current.session.snapshotEvents())
        if (produced) {
          appendNotice(t('noticeModeNotBlank'), 'warning')
          return
        }
        try {
          if (live === undefined) await presets.mount(current.ctx, target)
          else await presets.recompose(current.ctx, target)
          uiMode = target
          updateStatusValues()
          ui.requestRender()
          appendNotice(t('noticeModeSet', { mode: modeLabel(t, target, presetNames) }), 'info')
        } catch (error: unknown) {
          appendNotice(t('noticeModeSwitchFailed', { error: errorChain(error) }), 'error')
        }
        return
      }
      if (line === '/settings' || line.startsWith('/settings ')) {
        if (settings === undefined || tuiSettings === undefined) {
          appendNotice(t('noticeSettingsUnavailable'), 'warning')
          return
        }
        try {
          type SettingsView =
            | 'main'
            | 'theme'
            | 'theme-mode'
            | 'theme-dark'
            | 'theme-light'
            | 'theme-selected'
            | 'theme-custom'
            | 'show-reasoning'
            | 'tool-output-lines'
            | 'title-provider'
            | 'title-model'
            | 'default-permission'
            | 'default-provider'
            | 'default-model'
            | 'default-model-effort'
            | 'default-effort'
            | 'default-mode'
            | 'max-parallel-tool-calls'
            | 'model-actions'
            | 'wechat-progress-enabled'
            | 'wechat-notify'

          interface ProviderCatalogEntry {
            id: string
            name: string
            source: 'registered' | 'configurable'
            configurable?: LlmConfigurableProvider
            profile?: ConfiguredProviderProfile
          }

          const booleanItems: SelectItem[] = [
            { value: 'true', label: t('settingsOn') },
            { value: 'false', label: t('settingsOff') },
          ]
          const toolOutputLineOptions = [3, 6, 10, 20, 50]
          const parallelToolCallOptions = [1, 2, 4, 8, 10, 16, 32]
          const CUSTOM_PROVIDER = '\u0000custom-provider'
          const CUSTOM_MODEL = '\u0000custom-model'
          const EDIT_CUSTOM_PROVIDER = '\u0000edit-custom-provider'
          const EDIT_CUSTOM_MODEL = '\u0000edit-custom-model'

          const wechatBridge = (): WechatBridge | undefined => {
            try {
              return ctx.get('wechat') as WechatBridge | undefined
            } catch {

      return undefined
            }
          }
          const getWechatConfig = (): BridgeConfig | undefined => wechatBridge()?.getBridgeConfig()
          const setWechatConfig = (next: BridgeConfig): void => {
            const bridge = wechatBridge()
            if (bridge !== undefined) bridge.setBridgeConfig(next)
          }

          let providerCatalog: ProviderCatalogEntry[] = []
          let modelCatalog: Array<{ provider: string; model: string }> = []
          const refreshProviderModelCatalog = async (): Promise<void> => {
            const providers = new Map<string, ProviderCatalogEntry>()
            const configurableProviders = configurableProviderList()
            const configurableIds = new Set(configurableProviders.map(entry => entry.provider))
            const registeredProviders = typeof ctx.llm.listProviders === 'function'
              ? ctx.llm.listProviders()
              : []
            for (const entry of registeredProviders) {
              if (configurableIds.has(entry.id)) {
                providers.set(entry.id, { id: entry.id, name: entry.name, source: 'registered' })
              }
            }
            const profiles = configuredProviderProfiles()
            for (const entry of configurableProviders) {
              const existing = providers.get(entry.provider)
              const profile = profiles[entry.provider]
              if (existing !== undefined) {
                existing.configurable = entry
                existing.profile = profile
                if (profile?.displayName !== undefined && profile.displayName !== '') existing.name = profile.displayName
                else if (existing.name === existing.id) existing.name = entry.displayName
              } else {
                providers.set(entry.provider, {
                  id: entry.provider,
                  name: profile?.displayName || entry.displayName,
                  source: 'configurable',
                  configurable: entry,
                  ...(profile === undefined ? {} : { profile }),
                })
              }
            }
            providerCatalog = [...providers.values()]

            const models = new Map<string, { provider: string; model: string }>()
            const addModel = (provider: string, model: string): void => {
              const key = `${provider}\u0000${model}`
              if (!models.has(key)) models.set(key, { provider, model })
            }
            const modelLoaders: Promise<void>[] = []
            for (const entry of providerCatalog) {
              if (entry.profile?.models !== undefined) {
                for (const model of entry.profile.models) addModel(entry.id, model.id)
                continue
              }
              modelLoaders.push((async () => {
                try {
                  const found = await ctx.llm.listModels(entry.id)
                  for (const model of found) addModel(entry.id, model.id)
                } catch {
                  // Dormant providers may have no live model catalog yet.
                }
              })())
            }
            await Promise.all(modelLoaders)
            const defaultSelection = ctx.agentDefaultModel.currentSelection()
            addModel(defaultSelection.provider, defaultSelection.model)
            const titleSettings = settings.get(SESSION_TITLE_SETTINGS_NAMESPACE) as {
              provider?: string
              model?: string
            } | undefined
            if (titleSettings?.provider !== undefined && titleSettings.model !== undefined) {
              addModel(titleSettings.provider, titleSettings.model)
            }
            modelCatalog = [...models.values()]
          }

          const listModelsForProvider = async (provider: string): Promise<Awaited<ReturnType<typeof ctx.llm.listModels>>> => {
            try {
              return await ctx.llm.listModels(provider)
            } catch {
              return []
            }
          }

          const providerModelCount = (provider: string): number => {
            const entry = providerCatalog.find(candidate => candidate.id === provider)
            if (entry?.profile?.models !== undefined) return entry.profile.models.length
            return modelCatalog.filter(model => model.provider === provider).length
          }

          const providerCurrentValue = (provider: string): string => {
            const count = providerModelCount(provider)
            return count > 0 ? t('settingsProviderModelCount', { count }) : '—'
          }

          const modelCurrentValue = (provider: string, model: string): string => {
            const defaultSelection = ctx.agentDefaultModel.currentSelection()
            const titleSettings = settings.get(SESSION_TITLE_SETTINGS_NAMESPACE) as {
              provider?: string
              model?: string
            } | undefined
            const marks: string[] = []
            if (defaultSelection.provider === provider && defaultSelection.model === model) marks.push('★')
            if (titleSettings?.provider === provider && titleSettings.model === model) marks.push('T')
            if (marks.length > 0) return marks.join(' ')
            return '—'
          }

          const buildModelItems = (): SettingsItem[] => {
            const titleSettings = settings.get(SESSION_TITLE_SETTINGS_NAMESPACE) as {
              provider?: string
              model?: string
            } | undefined
            const titleProvider = titleSettings?.provider ?? current.options.provider ?? 'auto'
            const titleModel = titleSettings?.model ?? current.options.model ?? 'auto'
            const defaultSelection = ctx.agentDefaultModel.currentSelection()
            return [
              { value: 'title-model', label: t('settingsTitleModel'), currentValue: `${titleProvider}/${titleModel}` },
              { value: 'provider', label: t('settingsProvider'), currentValue: defaultSelection.provider },
              { value: 'model', label: t('settingsModel'), currentValue: defaultSelection.model },
              { value: 'custom-config', label: t('settingsCustomConfig'), currentValue: `${defaultSelection.provider}/${defaultSelection.model}` },
              { value: 'effort', label: t('settingsDefaultEffort'), currentValue: defaultSelection.reasoningEffort ?? '—' },
            ]
          }
          const themeSummary = (): string => themeMode === 'dynamic'
            ? `${t('settingsThemeModeDynamic')} · ${themeDark} / ${themeLight}`
            : `${t('settingsThemeModeSelected')} · ${themeSelected}`
          const themeCustomSummary = (): string => {
            const roles = themeCustom === undefined ? [] : Object.keys(themeCustom)
            return roles.length === 0 ? t('settingsThemeCustomNone') : roles.join(', ')
          }
          const buildSettingsTabs = (): SettingsTab[] => {
            const agentLoopSettings = settings.get('agent-loop') as {
              maxParallelToolCalls?: number
            } | undefined
            const maxParallelToolCalls = agentLoopSettings?.maxParallelToolCalls ?? 10
            const defaultSelection = ctx.agentDefaultModel.currentSelection()
            const titleSettings = settings.get(SESSION_TITLE_SETTINGS_NAMESPACE) as {
              provider?: string
              model?: string
            } | undefined
            const titleProvider = titleSettings?.provider ?? current.options.provider ?? 'auto'
            const titleModel = titleSettings?.model ?? current.options.model ?? 'auto'
            const defaultPermission = displayPermissionName(ctx.permissionPresets.defaultPreset)
            const defaultPreset = (settings.get('agent-presets') as {
              default?: string
            } | undefined)?.default
            const defaultMode = defaultPreset ?? ctx.agentPresets?.defaultId ?? resolved.mode
            const wechatConfig = getWechatConfig()
            return [
              {
                id: 'general',
                label: t('settingsTabGeneral'),
                items: [
                  { value: 'theme', label: t('settingsTheme'), currentValue: themeSummary() },
                  { value: 'theme-custom', label: t('settingsThemeCustom'), currentValue: themeCustomSummary() },
                  { value: 'show-reasoning', label: t('settingsShowReasoning'), currentValue: showReasoning ? t('settingsOn') : t('settingsOff') },
                  { value: 'tool-output-lines', label: t('settingsToolOutputLines'), currentValue: String(maxToolOutputLines) },
                  { value: 'provider', label: t('settingsDefaultModel'), currentValue: `${defaultSelection.provider}/${defaultSelection.model}` },
                  { value: 'effort', label: t('settingsDefaultEffort'), currentValue: defaultSelection.reasoningEffort ?? '—' },
                  { value: 'title-model', label: t('settingsTitleModel'), currentValue: `${titleProvider}/${titleModel}` },
                  { value: 'permission', label: t('settingsDefaultPermission'), currentValue: defaultPermission },
                  { value: 'default-mode', label: t('settingsDefaultMode'), currentValue: modeLabel(t, defaultMode, presetNames) },
                ],
              },
              {
                id: 'models-providers',
                label: t('settingsTabModelsProviders'),
                items: [
                  { value: '__providers-header', label: t('settingsConfiguredProviders'), currentValue: '' },
                  ...providerCatalog.map(entry => ({
                    value: `provider:${entry.id}`,
                    label: entry.name,
                    currentValue: providerCurrentValue(entry.id),
                  })),
                  { value: 'add-provider', label: t('settingsAddProvider'), currentValue: '' },
                  { value: '__models-header', label: t('settingsConfiguredModels'), currentValue: '' },
                  ...modelCatalog.map(model => ({
                    value: `model:${model.provider}\u0000${model.model}`,
                    label: `${model.provider}/${model.model}`,
                    currentValue: modelCurrentValue(model.provider, model.model),
                  })),
                ],
              },
              {
                id: 'advanced',
                label: t('settingsTabAdvanced'),
                items: [
                  { value: 'max-parallel-tool-calls', label: t('settingsMaxParallelToolCalls'), currentValue: String(maxParallelToolCalls) },
                  { value: 'left-prompt', label: t('settingsLeftPrompt'), currentValue: leftPrompt },
                  { value: 'right-prompt', label: t('settingsRightPrompt'), currentValue: rightPrompt },
                  { value: 'key-tools', label: t('settingsKeyTools'), currentValue: keyTools },
                  { value: 'key-reasoning', label: t('settingsKeyReasoning'), currentValue: keyReasoning },
                ],
              },
              {
                id: 'wechat',
                label: t('settingsTabWechat'),
                items: wechatConfig === undefined
                  ? [{ value: 'wechat-unavailable', label: t('settingsWechatUnavailable'), currentValue: '' }]
                  : [
                    { value: 'wechat-progress-enabled', label: t('settingsWechatProgressEnabled'), currentValue: wechatConfig.progress.enabled ? t('settingsOn') : t('settingsOff') },
                    { value: 'wechat-progress-interval', label: t('settingsWechatProgressInterval'), currentValue: String(wechatConfig.progress.interval) },
                    { value: 'wechat-notify', label: t('settingsWechatNotify'), currentValue: wechatConfig.notify ? t('settingsOn') : t('settingsOff') },
                  ],
              },
            ]
          }
          const themeItems: SelectItem[] = BUILTIN_THEMES.map(theme => ({
            value: theme.id,
            label: `${theme.id} — ${theme.label}`,
            description: `${theme.scheme} · ${theme.description}`,
          }))
          const themeMenuItems = (): SelectItem[] => {
            const modeText = themeMode === 'dynamic' ? t('settingsThemeModeDynamic') : t('settingsThemeModeSelected')
            const rows: SelectItem[] = [
              {
                value: 'mode',
                label: `${t('settingsThemeMode')} — ${modeText}`,
              },
            ]
            if (themeMode === 'dynamic') {
              rows.push(
                { value: 'dark', label: `${t('settingsThemeDark')} — ${themeDark}` },
                { value: 'light', label: `${t('settingsThemeLight')} — ${themeLight}` },
              )
            } else {
              rows.push({ value: 'selected', label: `${t('settingsThemeSelectedItem')} — ${themeSelected}` })
            }
            return rows
          }
          const booleanThemeModeItems: SelectItem[] = [
            { value: 'dynamic', label: t('settingsThemeModeDynamic') },
            { value: 'selected', label: t('settingsThemeModeSelected') },
          ]
          const themeCustomItems = (): SelectItem[] => COLOR_ROLES.map(role => {
            const rgb = themeCustom?.[role]
            return {
              value: role,
              label: `${role} — ${rgb === undefined ? t('settingsThemeCustomNone') : `[${rgb.join(', ')}]`}`,
            }
          })
          const providerItems = (): SelectItem[] => {
            const registeredProviders = typeof ctx.llm.listProviders === 'function' ? ctx.llm.listProviders() : []
            const registeredProviderIds = new Set(registeredProviders.map(entry => entry.id))
            return [
              ...registeredProviders.map(entry => ({
                value: entry.id,
                label: entry.name,
              })),
              ...Object.entries(configuredProviderProfiles())
                .filter(([id]) => !registeredProviderIds.has(id))
                .map(([id, profile]) => ({
                  value: id,
                  label: profile.displayName || id,
                })),
              { value: CUSTOM_PROVIDER, label: t('settingsCustomProvider') },
            ]
          }

          const screen = new SettingsScreen(
            buildSettingsTabs()[0]?.items ?? [],
            t('settingsTitle'),
            palette,
            t,
            Math.max(5, terminal.rows - 4),
            terminal.rows,
          )
          await refreshProviderModelCatalog()
          screen.setTabs(buildSettingsTabs(), t('settingsTitle'))
          let view: SettingsView = 'main'
          let viewVersion = 0
          let pendingProvider: string | undefined
          let pendingModel: ModelSelection | undefined
          let pendingModelItems: SelectItem[] = []
          let pendingEfforts: readonly LlmReasoningEffortInfo[] = []
          let busy = false
          let modelActionsBack = false

          const showItems = (
            nextView: Exclude<SettingsView, 'main'>,
            items: SelectItem[],
            title: string,
            selectedValue?: string,
          ): void => {
            view = nextView
            viewVersion++
            screen.setItems(items, title, selectedValue)
            ui.requestRender()
          }
          const showMain = (): void => {
            view = 'main'
            viewVersion++
            pendingProvider = undefined
            pendingModel = undefined
            pendingModelItems = []
            pendingEfforts = []
            modelActionsBack = false
            screen.setTabs(buildSettingsTabs(), t('settingsTitle'))
            ui.requestRender()
          }
          const promptCustom = async (title: string, initialValue?: string): Promise<string | undefined> => {
            const value = await showOverlay<string>(
              ui,
              done => new InputDialog(title, palette, done, t, initialValue),
              { width: '80%', maxHeight: '50%' },
            )
            const trimmed = value?.trim()
            return trimmed === '' ? undefined : trimmed
          }
          const providerPickerItems = (selected: string | undefined): SelectItem[] => {
            const known = new Set([
              ...(typeof ctx.llm.listProviders === 'function' ? ctx.llm.listProviders() : []).map(entry => entry.id),
              ...Object.keys(configuredProviderProfiles()),
            ])
            const items = providerItems()
            if (selected !== undefined && selected !== CUSTOM_PROVIDER && !known.has(selected)) {
              items.unshift({ value: selected, label: `${selected} — ${t('settingsCustomProvider')}` })
              items.splice(1, 0, { value: EDIT_CUSTOM_PROVIDER, label: t('settingsEditCustomProvider') })
            }
            return items
          }
          const modelPickerItems = (
            models: readonly { id: string; name?: string }[],
            selected: string | undefined,
          ): SelectItem[] => {
            const items: SelectItem[] = [
              ...models.map(entry => ({
                value: entry.id,
                label: entry.id,
                description: entry.name === undefined ? undefined : displayText(entry.name),
              })),
              { value: CUSTOM_MODEL, label: t('settingsCustomModel') },
            ]
            if (selected !== undefined && selected !== CUSTOM_MODEL && !models.some(entry => entry.id === selected)) {
              items.unshift({ value: selected, label: `${selected} — ${t('settingsCustomModel')}` })
              items.splice(1, 0, { value: EDIT_CUSTOM_MODEL, label: t('settingsEditCustomModel') })
            }
            return items
          }


          interface ProviderSettingsTarget {
            ns: string
            path: string[]
            entry: LlmConfigurableProvider
          }
          const providerSettingsTarget = (
            providerId: string,
            editingId?: string,
          ): ProviderSettingsTarget | undefined => {
            const entries = configurableProviderList()
            const entry = entries.find(candidate => candidate.provider === (editingId ?? providerId))
              ?? (editingId === undefined ? entries.find(candidate => candidate.settingsPath.length > 0) : undefined)
            if (entry === undefined || (editingId === undefined && entry.settingsPath.length === 0)) return undefined
            const path = editingId === undefined
              ? [...entry.settingsPath.slice(0, -1), providerId]
              : [...entry.settingsPath]
            return { ns: entry.settingsNs, path, entry }
          }

          const providerDiscoveryNamespace = (providerId: string | undefined): string | undefined => {
            const entries = configurableProviderList()
            const entry = entries.find(candidate => candidate.provider === providerId)
              ?? entries.find(candidate => candidate.settingsPath.length > 0)
              ?? entries[0]
            if (entry === undefined || typeof ctx.llm.discoverModels !== 'function') return undefined
            const runtime = ctx.llm as typeof ctx.llm & {
              listModelDiscoveryNamespaces?: () => readonly string[]
            }
            const namespaces = runtime.listModelDiscoveryNamespaces?.()
            if (namespaces !== undefined && !namespaces.includes(entry.settingsNs)) return undefined
            return entry.settingsNs
          }

          const credentialReference = (providerId: string): string => {
            const normalized = providerId.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
            return `${normalized || 'DSH_PROVIDER'}_API_KEY`
          }

          const saveProvider = async (providerId: string | undefined, draft: ProviderDraft): Promise<void> => {
            if (settings === undefined) throw new Error('settings unavailable')
            const id = draft.id.trim()
            if (id === '') throw new Error(t('providerIdRequired'))
            if (providerId !== undefined && providerId !== id) throw new Error(t('providerIdInvalid'))
            const target = providerSettingsTarget(id, providerId)
            if (target === undefined) throw new Error(t('settingsDiscoveryUnavailable'))
            const nestedProfile = target.entry.settingsPath.length > 0
            const catalogEntry = configurableProviderList().find(entry => entry.provider === id)
            const isCatalogProvider = catalogEntry?.declared === false || !nestedProfile
            if (nestedProfile && !isCatalogProvider && draft.models.length === 0) throw new Error(t('providerModelsRequired'))

            const apiKeyEnv = draft.apiKeyEnv ?? (draft.apiKey.trim() === '' ? undefined : credentialReference(id))
            if (draft.apiKey.trim() !== '') {
              const credentials = ctx.get('credentials') as { set?: (ref: string, value: string) => Promise<void> } | undefined
              if (credentials?.set === undefined || apiKeyEnv === undefined) {
                throw new Error('credentials service unavailable')
              }
              await credentials.set(apiKeyEnv, draft.apiKey.trim())
            }

            type SettingsMutation =
              | { op: 'set'; path: readonly string[]; value: unknown }
              | { op: 'unset'; path: readonly string[] }
            const ops: SettingsMutation[] = []
            const set = (field: string, value: unknown): void => { ops.push({ op: 'set', path: [...target.path, field], value }) }
            const unset = (field: string): void => { ops.push({ op: 'unset', path: [...target.path, field] }) }
            if (nestedProfile) {
              const displayName = draft.name.trim()
              if (displayName === '' || displayName === id) unset('displayName')
              else set('displayName', displayName)
              if (draft.api.trim() === '') unset('api')
              else set('api', draft.api.trim())
              if (draft.models.length === 0) unset('models')
              else set('models', draft.models.map(model => ({ id: model })))
            }
            if (draft.baseURL.trim() === '') unset('baseURL')
            else set('baseURL', draft.baseURL.trim())
            if (apiKeyEnv !== undefined) set('apiKeyEnv', apiKeyEnv)
            await settings.mutate(target.ns, ops)
            appendNotice(t('noticeProviderSaved'), 'info')
          }
          const openProviderForm = async (providerId?: string): Promise<void> => {
            if (settings === undefined) {
              appendNotice(t('noticeSettingsUnavailable'), 'warning')
              return
            }
            const existing = providerId === undefined ? undefined : providerCatalog.find(candidate => candidate.id === providerId)
            const profile = providerId === undefined ? undefined : configuredProviderProfiles()[providerId]

            let templateId = ''
            let templateName = ''
            if (providerId === undefined) {
              const addableProviders = configurableProviderList().filter(entry => entry.settingsPath.length > 0)
              const templateItems: SelectItem[] = [
                { value: '', label: t('settingsBlankProvider') },
                ...addableProviders.map(entry => ({
                  value: `preset:${entry.provider}`,
                  label: entry.displayName,
                })),
              ]
              const template = await showOverlay<string>(
                ui,
                done => new SelectDialog(t('settingsProviderTemplate'), templateItems, palette, done),
                { width: '70%', maxHeight: '70%' },
              )
              if (template === undefined) return
              if (template.startsWith('preset:')) {
                const presetId = template.slice('preset:'.length)
                const preset = addableProviders.find(entry => entry.provider === presetId)
                templateId = presetId
                templateName = preset?.displayName ?? ''
              }
            }

            const id = providerId ?? templateId
            const catalogEntry = configurableProviderList().find(entry => entry.provider === id)
            const isCatalogProvider = catalogEntry?.declared === false || catalogEntry?.settingsPath.length === 0
            const apiKeyEnv = profile?.apiKeyEnv
            const apiKeyConfigured = apiKeyEnv === undefined
              ? false
              : await (async () => {
                const credentials = ctx.get('credentials') as { describe?: (ref: string) => Promise<{ configured: boolean }> } | undefined
                if (credentials?.describe === undefined) return true
                try {
                  return (await credentials.describe(apiKeyEnv)).configured
                } catch {
                  return false
                }
              })()
            const draft: ProviderDraft = {
              id,
              name: profile?.displayName ?? existing?.name ?? templateName,
              api: profile?.api ?? '',
              baseURL: profile?.baseURL ?? '',
              apiKey: '',
              apiKeyEnv: profile?.apiKeyEnv,
              apiKeyConfigured,
              models: profile?.models?.map(model => model.id)
                ?? modelCatalog.filter(model => model.provider === providerId).map(model => model.model),
            }
            const submitted = await showOverlay<ProviderDraft>(
              ui,
              done => new ProviderForm(
                providerId === undefined ? t('settingsAddProvider') : t('settingsEditProvider'),
                palette,
                t,
                draft,
                done,
                {
                  discover: async (currentDraft) => {
                    if (typeof ctx.llm.discoverModels !== 'function') return undefined
                    const ns = providerDiscoveryNamespace(providerId)
                    if (ns === undefined) return undefined
                    try {
                      const found = await ctx.llm.discoverModels(ns, {
                        ...(providerId !== undefined ? { provider: providerId } : {}),
                        baseURL: currentDraft.baseURL || undefined,
                        apiKey: currentDraft.apiKey || undefined,
                        api: currentDraft.api || undefined,
                      })
                      return found as DiscoveredModel[]
                    } catch (error: unknown) {
                      appendNotice(t('noticeProviderFailed', { error: errorChain(error) }), 'error')

      return undefined
                    }
                  },
                  pickApi: async () => await showOverlay<string>(
                    ui,
                    done => new SelectDialog(
                      t('settingsApi'),
                      [
                        { value: SUPPORTED_PROVIDER_APIS[0], label: t('settingsApiOpenAiCompletions') },
                        { value: SUPPORTED_PROVIDER_APIS[1], label: t('settingsApiOpenAiResponses') },
                        { value: SUPPORTED_PROVIDER_APIS[2], label: t('settingsApiAnthropicMessages') },
                      ],
                      palette,
                      done,
                    ),
                    { width: '70%', maxHeight: '50%' },
                  ),
                  manageModels: async (currentDraft, discovered) => {
                    const all = [...new Set([
                      ...currentDraft.models,
                      ...discovered.map(model => model.id),
                    ])]
                    return showOverlay<string[]>(
                      ui,
                      done => new ModelListDialog(t('settingsModels'), all, palette, t, done),
                      { width: '90%', maxHeight: '85%' },
                    )
                  }
                },
                {
                  idEditable: providerId === undefined,
                  requireModels: !isCatalogProvider,
                  requireApi: !isCatalogProvider,
                  requireBaseURL: !isCatalogProvider,
                }
              ),
              { width: '90%', maxHeight: '85%' },
            )
            if (submitted === undefined) return
            await saveProvider(providerId, submitted)
            await refreshProviderModelCatalog()
            if (view === 'main') showMain()
          }

          const handleBack = (): void => {
            if (view === 'title-model') {
              showItems('title-provider', providerItems(), t('modelProvider'), pendingProvider)
              return
            }
            if (view === 'default-model') {
              showItems('default-provider', providerItems(), t('modelProvider'), pendingProvider)
              return
            }
            if (view === 'default-model-effort' && modelActionsBack) {
              modelActionsBack = false
              showMain()
              return
            }
            if (view === 'default-model-effort' && pendingProvider !== undefined) {
              showItems(
                'default-model',
                pendingModelItems,
                t('modelTitle', { provider: pendingProvider }),
                pendingModel?.model,
              )
              return
            }
            showMain()
          }

          const handleSelect = async (item: SelectItem): Promise<void> => {
            if (busy) return
            busy = true
            const selectedView = view
            const selectedVersion = viewVersion
            try {
              if (selectedView === 'main') {
                if (item.value === 'theme') {
                  showItems('theme', themeMenuItems(), t('settingsTheme'), 'mode')
                } else if (item.value === 'theme-custom') {
                  showItems('theme-custom', themeCustomItems(), t('settingsThemeCustom'), 'accent')
                } else if (item.value === 'show-reasoning') {
                  showItems('show-reasoning', booleanItems, t('settingsShowReasoning'), String(showReasoning))
                } else if (item.value === 'tool-output-lines') {
                  showItems(
                    'tool-output-lines',
                    toolOutputLineOptions.map(value => ({ value: String(value), label: String(value) })),
                    t('settingsToolOutputLines'),
                    String(maxToolOutputLines),
                  )
                } else if (item.value === 'title-model') {
                  const titleSettings = settings.get(SESSION_TITLE_SETTINGS_NAMESPACE) as {
                    provider?: string
                  } | undefined
                  showItems(
                    'title-provider',
                    providerPickerItems(titleSettings?.provider ?? current.options.provider),
                    t('modelProvider'),
                    titleSettings?.provider ?? current.options.provider,
                  )
                } else if (item.value === 'default-mode') {
                  const presets = ctx.agentPresets
                  if (presets === undefined) {
                    appendNotice(t('noticeModeUnavailable'), 'warning')
                    return
                  }
                  const presetsList = (await presets.list()).filter(preset => preset.broken === undefined)
                  const defaultMode = (settings.get('agent-presets') as {
                    default?: string
                  } | undefined)?.default ?? presets.defaultId
                  showItems(
                    'default-mode',
                    presetsList.map(preset => ({
                      value: preset.id,
                      label: preset.name === undefined ? preset.id : `${preset.id} — ${preset.name}`,
                      description: preset.description,
                    })),
                    t('settingsDefaultMode'),
                    defaultMode,
                  )
                } else if (item.value === 'max-parallel-tool-calls') {
                  const current = (settings.get('agent-loop') as {
                    maxParallelToolCalls?: number
                  } | undefined)?.maxParallelToolCalls ?? 10
                  showItems(
                    'max-parallel-tool-calls',
                    parallelToolCallOptions.map(value => ({ value: String(value), label: String(value) })),
                    t('settingsMaxParallelToolCalls'),
                    String(current),
                  )
                } else if (item.value === 'left-prompt' || item.value === 'right-prompt') {
                  const editLeft = item.value === 'left-prompt'
                  const initial = editLeft ? leftPrompt : rightPrompt
                  const answer = await showOverlay<string>(
                    ui,
                    done => new InputDialog(t('settingsPromptHint'), palette, done, t, initial),
                    { width: '80%', maxHeight: '50%' },
                  )
                  const trimmed = answer?.trim() ?? ''
                  const next = trimmed === ''
                    ? editLeft ? DEFAULT_LEFT_PROMPT : DEFAULT_RIGHT_PROMPT
                    : trimmed
                  if (editLeft) {
                    leftPrompt = next
                    leftTemplate = parseTuiPromptTemplate(displayInlineText(next))
                    statusLine = new StatusLineComponent(rightTemplate, promptValue, palette)
                  } else {
                    rightPrompt = next
                    rightTemplate = parseTuiPromptTemplate(displayInlineText(next))
                    footer = new ComposerFooterComponent(leftTemplate, promptValue, palette)
                  }
                  await tuiSettings.update({ leftPrompt, rightPrompt })
                  rebuildChrome()
                  appendNotice(t('noticePromptSet', { name: editLeft ? t('settingsLeftPrompt') : t('settingsRightPrompt') }), 'info')
                  if (selectedVersion === viewVersion && view === selectedView) showMain()
                  else ui.requestRender()
                  return                } else if (item.value === 'key-tools' || item.value === 'key-reasoning') {
                  const editTools = item.value === 'key-tools'
                  const initial = editTools ? keyTools : keyReasoning
                  const answer = await showOverlay<string>(
                    ui,
                    done => new InputDialog(t('settingsPromptHint'), palette, done, t, initial),
                    { width: '80%', maxHeight: '50%' },
                  )
                  const trimmed = answer?.trim() ?? ''
                  if (trimmed !== '') {
                    if (editTools) keyTools = trimmed
                    else keyReasoning = trimmed
                    await tuiSettings.update({ keyTools, keyReasoning })
                  }
                  appendNotice(t('noticeKeybindingSet', { name: editTools ? t('settingsKeyTools') : t('settingsKeyReasoning') }), 'info')
                  if (selectedVersion === viewVersion && view === selectedView) showMain()
                  else ui.requestRender()
                  return                } else if (item.value === 'wechat-progress-enabled') {
                  const wechatConfig = getWechatConfig()
                  if (wechatConfig === undefined) {
                    appendNotice(t('settingsWechatUnavailable'), 'warning')
                    return
                  }
                  showItems(
                    'wechat-progress-enabled',
                    booleanItems,
                    t('settingsWechatProgressEnabled'),
                    String(wechatConfig.progress.enabled),
                  )
                } else if (item.value === 'wechat-progress-interval') {
                  const wechatConfig = getWechatConfig()
                  if (wechatConfig === undefined) {
                    appendNotice(t('settingsWechatUnavailable'), 'warning')
                    return
                  }
                  const value = await promptCustom(t('settingsWechatProgressInterval'), String(wechatConfig.progress.interval))
                  if (value === undefined) return
                  const next = Number(value)
                  if (!Number.isInteger(next) || next <= 0) {
                    appendNotice(t('noticeWechatInvalidInterval'), 'warning')
                    return
                  }
                  setWechatConfig({ ...wechatConfig, progress: { ...wechatConfig.progress, interval: next } })
                  appendNotice(t('noticeSettingsSaved'), 'info')
                  if (selectedVersion === viewVersion && view === selectedView) showMain()
                } else if (item.value === 'wechat-notify') {
                  const wechatConfig = getWechatConfig()
                  if (wechatConfig === undefined) {
                    appendNotice(t('settingsWechatUnavailable'), 'warning')
                    return
                  }
                  showItems(
                    'wechat-notify',
                    booleanItems,
                    t('settingsWechatNotify'),
                    String(wechatConfig.notify),
                  )
                } else if (item.value === 'wechat-unavailable') {
                  appendNotice(t('settingsWechatUnavailable'), 'warning')
                } else if (item.value === 'permission') {
                  showItems(
                    'default-permission',
                    permissionCommand.options,
                    t('settingsDefaultPermission'),
                    displayPermissionName(ctx.permissionPresets.defaultPreset),
                  )
                } else if (item.value === 'provider') {
                  showItems(
                    'default-provider',
                    providerPickerItems(ctx.agentDefaultModel.currentSelection().provider),
                    t('modelProvider'),
                    ctx.agentDefaultModel.currentSelection().provider,
                  )
                } else if (item.value === 'model') {
                  const defaultSelection = ctx.agentDefaultModel.currentSelection()
                  const provider = defaultSelection.provider
                  let models: Awaited<ReturnType<typeof ctx.llm.listModels>> = []
                  try {
                    models = await listModelsForProvider(provider)
                  } catch {
                    // Keep the list empty and still allow a custom model id.
                  }
                  if (selectedVersion !== viewVersion || view !== selectedView) return
                  pendingProvider = provider
                  pendingModelItems = modelPickerItems(models, defaultSelection.model)
                  showItems(
                    'default-model',
                    pendingModelItems,
                    t('modelTitle', { provider: pendingProvider }),
                    defaultSelection.model,
                  )
                } else if (item.value === 'custom-config') {
                  const defaultSelection = ctx.agentDefaultModel.currentSelection()
                  const draft: CustomModelDraft = {
                    provider: defaultSelection.provider,
                    model: defaultSelection.model,
                    reasoningEffort: defaultSelection.reasoningEffort ?? '',
                    saveDefault: true,
                    saveTitle: false,
                  }
                  const submitted = await showOverlay<CustomModelDraft>(
                    ui,
                    done => new CustomModelForm(t('settingsCustomConfig'), palette, t, draft, done),
                    { width: '90%', maxHeight: '85%' },
                  )
                  if (selectedVersion !== viewVersion || view !== selectedView) return
                  if (submitted === undefined) {
                    ui.requestRender()
                    return
                  }
                  if (submitted.saveDefault) {
                    await ctx.agentDefaultModel.saveSelection({
                      provider: submitted.provider,
                      model: submitted.model,
                      ...submitted.reasoningEffort === ''
                        ? {}
                        : { reasoningEffort: submitted.reasoningEffort as ModelSelection['reasoningEffort'] },
                    })
                  }
                  if (submitted.saveTitle) {
                    await settings.update(SESSION_TITLE_SETTINGS_NAMESPACE, {
                      provider: submitted.provider,
                      model: submitted.model,
                    })
                  }
                  appendNotice(t('noticeSettingsSaved'), 'info')
                  if (selectedVersion === viewVersion && view === selectedView) showMain()
                } else if (item.value === 'effort') {
                  const defaultSelection = ctx.agentDefaultModel.currentSelection()
                  pendingEfforts = await reasoningEffortsFor(defaultSelection)
                  if (selectedVersion !== viewVersion || view !== selectedView) return
                  if (pendingEfforts.length === 0) {
                    appendNotice(t('noticeThinkUnsupported'), 'warning')
                    return
                  }
                  showItems(
                    'default-effort',
                    pendingEfforts.map(effort => ({ value: effort.id, label: `${effort.id} — ${effort.name}`, description: effort.description })),
                    t('settingsDefaultEffort'),
                    defaultSelection.reasoningEffort,
                  )
                } else if (item.value === 'add-provider') {
                  await openProviderForm()
                } else if (item.value.startsWith('provider:')) {
                  await openProviderForm(item.value.slice('provider:'.length))
                } else if (item.value.startsWith('model:')) {
                  const route = item.value.slice('model:'.length)
                  const separator = route.indexOf('\u0000')
                  if (separator >= 0) {
                    const provider = route.slice(0, separator)
                    const model = route.slice(separator + 1)
                    pendingProvider = provider
                    pendingModel = { provider, model }
                    showItems(
                      'model-actions',
                      [
                        { value: 'set-default', label: t('settingsSetDefaultModel') },
                        { value: 'set-title', label: t('settingsSetTitleModel') },
                        { value: 'set-effort', label: t('settingsDefaultEffort') },
                      ],
                      `${provider}/${model}`,
                    )
                  }
                }
                return
              }

              if (selectedView === 'theme') {
                if (item.value === 'mode') {
                  showItems('theme-mode', booleanThemeModeItems, t('settingsThemeMode'), themeMode)
                } else if (item.value === 'dark') {
                  showItems('theme-dark', themeItems, t('settingsThemeDark'), themeDark)
                } else if (item.value === 'light') {
                  showItems('theme-light', themeItems, t('settingsThemeLight'), themeLight)
                } else if (item.value === 'selected') {
                  showItems('theme-selected', themeItems, t('settingsThemeSelectedItem'), themeSelected)
                }
                return
              }

              if (selectedView === 'theme-mode') {
                themeMode = item.value === 'dynamic' ? 'dynamic' : 'selected'
                await tuiSettings.update({ themeMode, themeDark, themeLight, themeSelected })
                Object.assign(palette, createPalette(resolved.theme.color, currentScheme, truecolor, themeOverride()))
                Object.assign(mdTheme, markdownTheme(palette))
                rebuildTranscript()
                setStatus(current.status)
                appendNotice(t('noticeSettingsSaved'), 'info')
                if (selectedVersion === viewVersion && view === selectedView) showMain()
                else ui.requestRender()
                return
              }

              if (selectedView === 'theme-dark' || selectedView === 'theme-light' || selectedView === 'theme-selected') {
                if (selectedView === 'theme-dark') themeDark = item.value
                if (selectedView === 'theme-light') themeLight = item.value
                if (selectedView === 'theme-selected') themeSelected = item.value
                await tuiSettings.update({ themeMode, themeDark, themeLight, themeSelected })
                Object.assign(palette, createPalette(resolved.theme.color, currentScheme, truecolor, themeOverride()))
                Object.assign(mdTheme, markdownTheme(palette))
                rebuildTranscript()
                setStatus(current.status)
                appendNotice(t('noticeSettingsSaved'), 'info')
                if (selectedVersion === viewVersion && view === selectedView) showMain()
                else ui.requestRender()
                return
              }

              if (selectedView === 'theme-custom') {
                const role = item.value
                const currentRgb = themeCustom?.[role]
                const initial = currentRgb === undefined ? '' : currentRgb.join(', ')
                const answer = await showOverlay<string>(
                  ui,
                  done => new InputDialog(t('settingsThemeCustomEditHint'), palette, done, t, initial),
                  { width: '80%', maxHeight: '50%' },
                )
                const trimmed = answer?.trim() ?? ''
                const next = { ...(themeCustom ?? {}) } as Record<string, number[]>
                if (trimmed === '') {
                  delete next[role]
                } else {
                  const parts = trimmed.split(',').map(part => Number(part.trim()))
                  if (parts.length !== 3 || parts.some(part => !Number.isFinite(part) || part < 0 || part > 255)) {
                    appendNotice(t('noticeThemeCustomInvalid'), 'warning')
                    if (selectedVersion === viewVersion && view === selectedView) showMain()
                    else ui.requestRender()
                    return
                  }
                  next[role] = [parts[0]!, parts[1]!, parts[2]!]
                }
                themeCustom = Object.keys(next).length === 0 ? undefined : next
                await tuiSettings.update({ themeMode, themeDark, themeLight, themeSelected, themeCustom })
                Object.assign(palette, createPalette(resolved.theme.color, currentScheme, truecolor, themeOverride()))
                Object.assign(mdTheme, markdownTheme(palette))
                rebuildTranscript()
                setStatus(current.status)
                appendNotice(t('noticeThemeCustomSet', { name: role }), 'info')
                if (selectedVersion === viewVersion && view === selectedView) showMain()
                else ui.requestRender()
                return
              }
              if (selectedView === 'show-reasoning') {
                const next = item.value === 'true'
                await tuiSettings.update({ showReasoning: next })
                showReasoning = next
                appendNotice(t('noticeSettingsSaved'), 'info')
                if (selectedVersion === viewVersion && view === selectedView) showMain()
                return
              }

              if (selectedView === 'tool-output-lines') {
                const next = Number(item.value)
                await tuiSettings.update({ maxToolOutputLines: next })
                maxToolOutputLines = next
                rebuildTranscript()
                appendNotice(t('noticeSettingsSaved'), 'info')
                if (selectedVersion === viewVersion && view === selectedView) showMain()
                return
              }

              if (selectedView === 'default-mode') {
                await settings.update('agent-presets', { default: item.value })
                appendNotice(t('noticeDefaultModeSet', { mode: modeLabel(t, item.value, presetNames) }), 'info')
                if (selectedVersion === viewVersion && view === selectedView) showMain()
                return
              }

              if (selectedView === 'max-parallel-tool-calls') {
                const next = Number(item.value)
                await settings.update('agent-loop', { maxParallelToolCalls: next })
                appendNotice(t('noticeSettingsSaved'), 'info')
                if (selectedVersion === viewVersion && view === selectedView) showMain()
                return
              }

              if (selectedView === 'wechat-progress-enabled') {
                const wechatConfig = getWechatConfig()
                if (wechatConfig === undefined) {
                  appendNotice(t('settingsWechatUnavailable'), 'warning')
                  return
                }
                setWechatConfig({
                  ...wechatConfig,
                  progress: { ...wechatConfig.progress, enabled: item.value === 'true' },
                })
                appendNotice(t('noticeSettingsSaved'), 'info')
                if (selectedVersion === viewVersion && view === selectedView) showMain()
                return
              }

              if (selectedView === 'wechat-notify') {
                const wechatConfig = getWechatConfig()
                if (wechatConfig === undefined) {
                  appendNotice(t('settingsWechatUnavailable'), 'warning')
                  return
                }
                setWechatConfig({ ...wechatConfig, notify: item.value === 'true' })
                appendNotice(t('noticeSettingsSaved'), 'info')
                if (selectedVersion === viewVersion && view === selectedView) showMain()
                return
              }

              if (selectedView === 'title-provider') {
                const titleSettings = settings.get(SESSION_TITLE_SETTINGS_NAMESPACE) as {
                  provider?: string
                  model?: string
                } | undefined
                const savedProvider = titleSettings?.provider ?? current.options.provider
                const provider = item.value === CUSTOM_PROVIDER
                  ? await promptCustom(t('modelProvider'))
                  : item.value === EDIT_CUSTOM_PROVIDER
                    ? await promptCustom(t('settingsEditCustomProvider'), savedProvider)
                    : item.value
                if (provider === undefined) return
                const models = await listModelsForProvider(provider)
                if (selectedVersion !== viewVersion || view !== selectedView) return
                pendingProvider = provider
                const savedModel = titleSettings?.provider === provider ? titleSettings.model : undefined
                pendingModelItems = modelPickerItems(models, savedModel)
                showItems(
                  'title-model',
                  pendingModelItems,
                  t('modelTitle', { provider: pendingProvider }),
                  savedModel,
                )
                return
              }

              if (selectedView === 'title-model') {
                if (pendingProvider === undefined) return
                const titleSettings = settings.get(SESSION_TITLE_SETTINGS_NAMESPACE) as {
                  provider?: string
                  model?: string
                } | undefined
                const savedModel = titleSettings?.provider === pendingProvider ? titleSettings.model : undefined
                const model = item.value === CUSTOM_MODEL
                  ? await promptCustom(t('modelTitle', { provider: pendingProvider }))
                  : item.value === EDIT_CUSTOM_MODEL
                    ? await promptCustom(t('settingsEditCustomModel'), savedModel)
                    : item.value
                if (model === undefined) return
                await settings.update(SESSION_TITLE_SETTINGS_NAMESPACE, { provider: pendingProvider, model })
                const sessionTitle = ctx.get('sessionTitle')
                if (sessionTitle !== undefined) void sessionTitle.refresh(current.session).catch(() => undefined)
                appendNotice(t('noticeTitleModelSet', { provider: pendingProvider, model }), 'info')
                if (selectedVersion === viewVersion && view === selectedView) showMain()
                return
              }

              if (selectedView === 'default-permission') {
                const registryName = registryPermissionName(item.value)
                await settings.update(PERMISSION_SETTINGS_NAMESPACE, { defaultPreset: registryName })
                appendNotice(t('noticeDefaultPermissionSet', { permission: displayPermissionName(registryName) }), 'info')
                if (selectedVersion === viewVersion && view === selectedView) showMain()
                return
              }

              if (selectedView === 'default-provider') {
                const defaultSelection = ctx.agentDefaultModel.currentSelection()
                const savedProvider = defaultSelection.provider
                const provider = item.value === CUSTOM_PROVIDER
                  ? await promptCustom(t('modelProvider'))
                  : item.value === EDIT_CUSTOM_PROVIDER
                    ? await promptCustom(t('settingsEditCustomProvider'), savedProvider)
                    : item.value
                if (provider === undefined) return
                const models = await listModelsForProvider(provider)
                if (selectedVersion !== viewVersion || view !== selectedView) return
                pendingProvider = provider
                const savedModel = defaultSelection.provider === provider ? defaultSelection.model : undefined
                pendingModelItems = modelPickerItems(models, savedModel)
                showItems(
                  'default-model',
                  pendingModelItems,
                  t('modelTitle', { provider: pendingProvider }),
                  savedModel,
                )
                return
              }

              if (selectedView === 'default-model') {
                if (pendingProvider === undefined) return
                const defaultSelection = ctx.agentDefaultModel.currentSelection()
                const savedModel = defaultSelection.provider === pendingProvider ? defaultSelection.model : undefined
                const model = item.value === CUSTOM_MODEL
                  ? await promptCustom(t('modelTitle', { provider: pendingProvider }))
                  : item.value === EDIT_CUSTOM_MODEL
                    ? await promptCustom(t('settingsEditCustomModel'), savedModel)
                    : item.value
                if (model === undefined) return
                const selectedModel: ModelSelection = { provider: pendingProvider, model }
                try {
                  const info = await ctx.llm.resolveModelInfo(pendingProvider, model)
                  pendingEfforts = info.reasoning?.efforts ?? []
                } catch {
                  pendingEfforts = []
                }
                if (selectedVersion !== viewVersion || view !== selectedView) return
                pendingModel = selectedModel
                if (pendingEfforts.length > 1) {
                  modelActionsBack = false
                  showItems(
                    'default-model-effort',
                    pendingEfforts.map(effort => ({ value: effort.id, label: `${effort.id} — ${effort.name}`, description: effort.description })),
                    t('modelEffort'),
                    defaultSelection.provider === pendingProvider && defaultSelection.model === model
                      ? defaultSelection.reasoningEffort
                      : undefined,
                  )
                } else {
                  await ctx.agentDefaultModel.saveSelection(selectedModel)
                  appendNotice(t('noticeDefaultModelSet', { provider: selectedModel.provider, model: selectedModel.model }), 'info')
                  if (selectedVersion === viewVersion && view === selectedView) showMain()
                }
                return
              }

              if (selectedView === 'default-model-effort') {
                if (pendingModel === undefined) return
                await ctx.agentDefaultModel.saveSelection({
                  ...pendingModel,
                  reasoningEffort: item.value as ModelSelection['reasoningEffort'],
                })
                appendNotice(t('noticeDefaultModelSet', { provider: pendingModel.provider, model: pendingModel.model }), 'info')
                if (selectedVersion === viewVersion && view === selectedView) showMain()
                return
              }

              if (selectedView === 'default-effort') {
                const currentDefault = ctx.agentDefaultModel.currentSelection()
                await ctx.agentDefaultModel.saveSelection({
                  ...currentDefault,
                  reasoningEffort: item.value as ModelSelection['reasoningEffort'],
                })
                appendNotice(t('noticeDefaultEffortSet', { effort: item.label }), 'info')
                if (selectedVersion === viewVersion && view === selectedView) showMain()
                return
              }

              if (selectedView === 'model-actions') {
                if (pendingModel === undefined) return
                if (item.value === 'set-default') {
                  const selectedModel = pendingModel
                  try {
                    const info = await ctx.llm.resolveModelInfo(selectedModel.provider, selectedModel.model)
                    pendingEfforts = info.reasoning?.efforts ?? []
                  } catch {
                    pendingEfforts = []
                  }
                  if (pendingEfforts.length > 1) {
                    modelActionsBack = true
                    showItems(
                      'default-model-effort',
                      pendingEfforts.map(effort => ({ value: effort.id, label: `${effort.id} — ${effort.name}`, description: effort.description })),
                      t('modelEffort'),
                      ctx.agentDefaultModel.currentSelection().provider === selectedModel.provider &&
                        ctx.agentDefaultModel.currentSelection().model === selectedModel.model
                        ? ctx.agentDefaultModel.currentSelection().reasoningEffort
                        : undefined,
                    )
                  } else {
                    await ctx.agentDefaultModel.saveSelection(selectedModel)
                    appendNotice(t('noticeDefaultModelSet', { provider: selectedModel.provider, model: selectedModel.model }), 'info')
                    if (selectedVersion === viewVersion && view === selectedView) showMain()
                  }
                } else if (item.value === 'set-title') {
                  await settings.update(SESSION_TITLE_SETTINGS_NAMESPACE, {
                    provider: pendingModel.provider,
                    model: pendingModel.model,
                  })
                  const sessionTitle = ctx.get('sessionTitle')
                  if (sessionTitle !== undefined) void sessionTitle.refresh(current.session).catch(() => undefined)
                  appendNotice(t('noticeTitleModelSet', { provider: pendingModel.provider, model: pendingModel.model }), 'info')
                  if (selectedVersion === viewVersion && view === selectedView) showMain()
                } else if (item.value === 'set-effort') {
                  pendingEfforts = await reasoningEffortsFor(pendingModel)
                  if (pendingEfforts.length === 0) {
                    appendNotice(t('noticeThinkUnsupported'), 'warning')
                    return
                  }
                  modelActionsBack = true
                  showItems(
                    'default-model-effort',
                    pendingEfforts.map(effort => ({ value: effort.id, label: `${effort.id} — ${effort.name}`, description: effort.description })),
                    t('modelEffort'),
                    ctx.agentDefaultModel.currentSelection().provider === pendingModel.provider &&
                      ctx.agentDefaultModel.currentSelection().model === pendingModel.model
                      ? ctx.agentDefaultModel.currentSelection().reasoningEffort
                      : undefined,
                  )
                }
              }
            } catch (error: unknown) {
              appendNotice(t('noticeSettingsFailed', { error: errorChain(error) }), 'error')
            } finally {
              busy = false
            }
          }

          screen.onSelect = (item) => {
            void handleSelect(item)
          }
          screen.onBack = handleBack

          // Keep settings as a windowed overlay instead of replacing the whole viewport.
          const handle = ui.showOverlay(screen, { anchor: 'center', width: '80%', maxHeight: '80%', margin: 1 })
          await new Promise<void>((resolve) => {
            screen.onClose = () => {
              handle.hide()
              resolve()
            }
          })
          ui.requestRender()
        } catch (error: unknown) {
          appendNotice(t('noticeSettingsFailed', { error: errorChain(error) }), 'error')
        }
        return
      }

      if (line === '/theme' || line.startsWith('/theme ')) {
        const arg = line.slice('/theme'.length).trim()
        const applyTheme = async (): Promise<void> => {
          previewThemeId = undefined
          if (tuiSettings !== undefined) {
            try {
              await tuiSettings.update({ themeMode, themeDark, themeLight, themeSelected })
            } catch (error: unknown) {
              appendNotice(t('noticeSettingsFailed', { error: errorChain(error) }), 'error')
              return
            }
          }
          repaintTheme(undefined, true)
        }
        const result = resolveThemeCommand(arg, {
          mode: themeMode,
          dark: themeDark,
          light: themeLight,
          selected: themeSelected,
        }, id => findTheme(id) !== undefined)
        if (result.kind === 'summary') {
          const modeText = result.state.mode === 'dynamic' ? t('settingsThemeModeDynamic') : t('settingsThemeModeSelected')
          const selectionText = result.state.mode === 'dynamic'
            ? `${result.state.dark} / ${result.state.light}`
            : result.state.selected
          appendNotice(`${t('themeCurrent')}: ${modeText} · ${selectionText}`, 'info')
          return
        }
        if (result.kind === 'error') {
          appendNotice(result.reason === 'mode'
            ? t('noticeThemeModeUnknown', { name: result.value })
            : t('noticeThemeUnknown', { name: result.value }), 'warning')
          return
        }
        themeMode = result.state.mode
        themeDark = result.state.dark
        themeLight = result.state.light
        themeSelected = result.state.selected
        await applyTheme()
        if (result.changed === 'mode') {
          appendNotice(t('noticeThemeModeSet', { mode: t(result.value === 'dynamic' ? 'settingsThemeModeDynamic' : 'settingsThemeModeSelected') }), 'info')
        } else if (result.changed === 'dark') {
          appendNotice(t('noticeThemeDarkSet', { name: result.value }), 'info')
        } else if (result.changed === 'light') {
          appendNotice(t('noticeThemeLightSet', { name: result.value }), 'info')
        } else {
          appendNotice(t('noticeThemeSet', { name: result.value }), 'info')
        }
        return
      }
      if (line === '/help' || line.startsWith('/help ')) {
        const commandRows = ctx.commands.list(current).map(command => {
          const permission = command.name === 'permission'
          const hint = permission ? permissionCommand.argumentHint : command.input?.hint
          const description = permission ? t('helpPermission') : command.description
          return `/${command.name}${hint === undefined ? '' : ` ${hint}`} — ${description}`
        })
        const rows = [
          palette.bold(palette.accent(t('helpShortcuts'))),
          '',
          `${palette.dim('Esc')}  ${t('helpEscape')}`,
          `${palette.dim('Ctrl+C')}  ${t('helpCtrlC')}`,
          `${palette.dim('Ctrl+O')}  ${t('helpCtrlO')}`,
          `${palette.dim('Ctrl+R')}  ${t('helpCtrlR')}`,
          `${palette.dim(process.platform === 'win32' ? 'Alt+V' : 'Ctrl+V')}  ${t('helpImagePaste')}`,
          '',
          palette.bold(palette.accent(t('helpCommands'))),
          `/palette — ${t('helpPalette')}`,
          `/help — ${t('helpHelp')}`,
          `/model — ${t('helpModel')}`,
          `/think [level] — ${t('helpThink')}`,
          `/new — ${t('helpNew')}`,
          `/fork [name] — ${t('helpFork')}`,
          `/rename [name] — ${t('helpRename')}`,
          `/resume [sessionId|name] — ${t('helpResume')}`,
          `/copy — ${t('helpCopy')}`,
          `/reload — ${t('helpReload')}`,
          `/details — ${t('helpDetails')}`,
          `/skills — ${t('helpSkills')}`,
          `/skill:<name> ${t('skillArgumentHint')} — ${t('helpSkillInvoke')}`,
          `/mode — ${t('helpMode')}`,
          `/theme — ${t('helpTheme')}`,
          `/settings — ${t('helpSettings')}`,
          `/context — ${t('helpContext')}`,
          ...commandRows,
        ]
        chat.addChild(new StaticCardComponent(rows, palette))
        ui.requestRender()
        return
      }
      const execution = await ctx.commands.execute(
        current,
        line,
        images,
        new AbortController().signal,
      )
      if (execution === undefined) {
        onImageRejected?.()
        appendNotice(t('noticeUnknownCommand', {
          name: line.slice(1, line.indexOf(' ') === -1 ? undefined : line.indexOf(' ')),
        }), 'warning')
        return
      }
      const result = execution.result
      // Command handlers use an error result to tell capable composers to
      // retain rejected attachment input (including sub-command grammar misses).
      if (result.kind === 'error') onImageRejected?.()
      const resultText = result.text?.replaceAll(FULL_ACCESS_REGISTRY_NAME, FULL_ACCESS_UI_NAME)
      const isWechatCommand = line.startsWith('/wechat-')
      const isJobsCommand = line === '/jobs'
      if ((isWechatCommand || isJobsCommand) && resultText !== undefined && resultText !== '') {
        // Multiline operational results stay in the transcript instead of being
        // collapsed into the five-second single-line notice slot.
        const color = result.kind === 'error' ? palette.error : palette.text
        chat.addChild(new StaticCardComponent(
          displayText(resultText).split('\n').map(row => color(row)),
          palette,
        ))
        ui.requestRender()
        return
      }
      if (result.kind === 'error') {
        appendNotice(resultText ?? '', 'error')
        if (line.trim() === '/compact') {
          const cause = latestCompactionError()
          if (cause !== undefined && cause !== '' && !String(resultText ?? '').includes(cause)) {
            appendNotice(t('noticeCompactionCause', { cause }), 'error')
          }
          if (cause !== undefined && cause.includes('400 status code')) {
            appendNotice(t('noticeCompaction400Hint'), 'warning')
          } else {
            appendNotice(t('noticeCompactionHint'), 'warning')
          }
        }
      } else if (resultText !== undefined && resultText !== '') {
        appendNotice(resultText, 'info')
      }
    }

    const enqueueUserMessage = (operation: () => Promise<void> | void): void => {
      const queued = (messageSubmissionTail ?? Promise.resolve()).then(operation)
      const settled = queued.catch((error: unknown) => {
        if (!imagePasteDisposed) {
          appendNotice(t('noticeImageSubmitFailed', { error: errorChain(error) }), 'error')
        }
      })
      messageSubmissionTail = settled
      void settled.then(() => {
        if (messageSubmissionTail === settled) messageSubmissionTail = undefined
      })
    }

    const projectImmediateUserMessage = (message: UserMessage, status: AgentStatus): Component | undefined => {
      if (!shouldProjectImmediateUserInput(status)) return undefined
      const text = displayText(contentText(message.content).trim())
      if (text === '') return undefined
      const projected = new Container()
      projected.addChild(new Spacer(1))
      projected.addChild(new UserMessageComponent(text, palette, mdTheme))
      immediateUserMessages.set(message.id, projected)
      chat.addChild(projected)
      ui.requestRender()
      return projected
    }

    const rollbackImmediateUserMessage = (message: UserMessage, projected: Component | undefined): void => {
      if (projected === undefined || !immediateUserMessages.delete(message.id)) return
      chat.removeChild(projected)
      ui.requestRender()
    }

    const activeShellControllers = new Set<AbortController>()
    ctx.effect(() => () => {
      for (const controller of activeShellControllers) controller.abort()
      activeShellControllers.clear()
    }, 'tui: abort active user shell commands')

    const runShellCommand = async (target: Agent, command: string): Promise<void> => {
      const shell = process.platform === 'win32' ? 'pwsh' : 'bash'
      const { card, wrapper } = appendShellCard(shell, command)
      ui.requestRender()
      const controller = new AbortController()
      activeShellControllers.add(controller)
      let result: ShellCommandResult
      try {
        const spec = ctx.shell.resolve({
          command,
          workdir: target.session.header.cwd,
          stdoutMaxBytes: 64 * 1024,
          signal: controller.signal,
        })
        result = shellCommandResult(shell, command, await ctx.shell.run(spec))
      } catch (error: unknown) {
        result = shellInfrastructureFailure(shell, command, error)
      } finally {
        activeShellControllers.delete(controller)
      }

      card.updateDispatch(
        [{ type: 'text', text: renderShellResultText(result) }],
        shellResultFailed(result),
      )
      ui.requestRender()

      const message = createUserMessage({
        content: [{ type: 'text', text: serializeShellUserMessage(result) }],
        source: { kind: 'user' },
      })
      if (agent === target) immediateShellMessages.set(message.id, wrapper)
      try {
        recordActivePreset(target)
        target.followup(message)
        if (agent === target) {
          pendingInputPanel.sync([...target.inbox.nextStep, ...target.inbox.nextTurn])
          refreshPendingInput()
        }
        const sessionTitle = ctx.get('sessionTitle')
        if (sessionTitle !== undefined && foldSessionTitle(target.session.snapshotEvents()) === undefined) {
          void sessionTitle.refresh(target.session).catch(() => undefined)
        }
      } catch (error: unknown) {
        immediateShellMessages.delete(message.id)
        card.updateDispatch([{
          type: 'text',
          text: `${renderShellResultText(result)}\n\nAgent delivery failed: ${errorChain(error)}`,
        }], true)
        ui.requestRender()
      }
    }

    editor.onSubmit = (text: string): void => {
      const current = agent
      if (current === undefined) return
      const trimmed = text.trim()
      if (trimmed === '') return
      editor.addToHistory(text)

      const generation = activeAgentGeneration
      const ownsEditor = (): boolean => !imagePasteDisposed
        && agent === current
        && activeAgentGeneration === generation
      const submission = imagePasteDraft.take(text)
      const restoreSubmission = (): void => {
        if (!ownsEditor() || editor.getText() !== '' || !imagePasteDraft.restore(submission)) return
        editor.setText(text)
      }

      if (trimmed.startsWith('!')) {
        const command = parseBangShellCommand(text)
        if (command === undefined) return
        if (submission.images.length > 0) {
          restoreSubmission()
          appendNotice(t('noticeImageCommandUnsupported', { name: '!' }), 'warning')
          return
        }
        void runShellCommand(current, command)
        return
      }

      if (trimmed.startsWith('/')) {
        const commandName = /^\/([^\s]+)/u.exec(trimmed)?.[1] ?? ''
        const command = commandName === '' ? undefined : ctx.commands.find(current, commandName)
        if (submission.images.length > 0 && command?.input?.images !== true) {
          restoreSubmission()
          appendNotice(t('noticeImageCommandUnsupported', { name: commandName }), 'warning')
          return
        }
        void runCommand(trimmed, encodeImageSubmission(submission), restoreSubmission).catch((error: unknown) => {
          restoreSubmission()
          if (ownsEditor()) {
            appendNotice(t('noticeImageSubmitFailed', { error: errorChain(error) }), 'error')
          }
        })
        return
      }

      const refreshTitle = (): void => {
        const sessionTitle = ctx.get('sessionTitle')
        if (sessionTitle !== undefined && foldSessionTitle(current.session.snapshotEvents()) === undefined) {
          void sessionTitle.refresh(current.session).catch(() => undefined)
        }
      }
      const parsed = parseSessionReferenceText(text)
      const deliver = (content: ContentBlock[], additionalContext?: Awaited<ReturnType<typeof ctx.sessionReferenceResolver.prepare>>['additionalContext']): void => {
        if (!ownsEditor()) return
        if (additionalContext !== undefined) current.inject(additionalContext)
        recordActivePreset(current)
        const message = createUserMessage({ content, source: { kind: 'user' } })
        const projected = projectImmediateUserMessage(message, current.status)
        try {
          current.steer(message)
        } catch (error: unknown) {
          rollbackImmediateUserMessage(message, projected)
          throw error
        }
        refreshTitle()
      }

      // Preserve the synchronous path unless an earlier image/reference submit
      // is still committing; later messages then queue behind it in editor order.
      if (submission.images.length === 0 && parsed.references.length === 0) {
        const content: ContentBlock[] = [{ type: 'text', text }]
        if (messageSubmissionTail === undefined) deliver(content)
        else enqueueUserMessage(() => { deliver(content) })
        return
      }

      enqueueUserMessage(async () => {
        if (!ownsEditor()) return
        let content: ContentBlock[] = [{ type: 'text', text: parsed.text }]
        let additionalContext: Awaited<ReturnType<typeof ctx.sessionReferenceResolver.prepare>>['additionalContext']
        if (parsed.references.length > 0) {
          try {
            const prepared = await ctx.sessionReferenceResolver.prepare(
              current,
              content,
              parsed.references,
            )
            if (!ownsEditor()) return
            content = [...prepared.content]
            additionalContext = prepared.additionalContext
          } catch (error: unknown) {
            if (ownsEditor()) {
              restoreSubmission()
              appendNotice(t('noticeReferenceFailed', { error: errorChain(error) }), 'error')
            }
            return
          }
        }

        if (submission.images.length > 0) {
          try {
            const refs = await ctx.attachments.saveImages(
              submission.images.map(image => image.input),
            )
            if (!ownsEditor()) return
            content.push(...refs.map(attachment => ({ type: 'image' as const, attachment })))
          } catch (error: unknown) {
            if (ownsEditor()) {
              restoreSubmission()
              appendNotice(t('noticeImageSubmitFailed', { error: errorChain(error) }), 'error')
            }
            return
          }
        }

        try {
          deliver(content, additionalContext)
        } catch (error: unknown) {
          if (ownsEditor()) {
            restoreSubmission()
            appendNotice(t('noticeImageSubmitFailed', { error: errorChain(error) }), 'error')
          }
        }
      })
    }

    // Ctrl+C clears a non-empty draft first. With a running turn, an empty
    // draft cancels and recalls queued steer text; while idle, an empty draft
    // keeps the existing double-press exit gesture.
    let exitArmed = false
    let exitArmTimer: NodeJS.Timeout | undefined
    const EXIT_ARM_WINDOW_MS = 2000

    const recallPendingInput = (current: Agent): boolean => {
      const pending = recallablePendingInput([...current.inbox.nextStep, ...current.inbox.nextTurn])
      if (pending.length === 0) return false
      const merged = mergePendingInput(pending, editor.getText())
      for (const message of pending) {
        const retained = retainedPendingInputContent(message)
        if (retained.length === 0) {
          current.inbox.remove(message.id)
        } else {
          current.inbox.replace(message.id, createUserMessage({
            content: retained,
            source: message.source,
          }))
        }
      }
      pendingInputPanel.sync([...current.inbox.nextStep, ...current.inbox.nextTurn])
      editor.setText(merged)
      refreshPendingInput()
      return true
    }

    const offKeys = ui.addInputListener((data) => {
      restoreComposerFocus(
        ui,
        editor,
        composerMounted && inlineQuestionDepth === 0 && !subagentPanel.isExpanded(),
      )
      // Capturing overlays (resume/model/settings/question dialogs) own their
      // keystrokes. App-wide background navigation must not swallow Enter,
      // arrows, or Escape before pi-tui dispatches them to the focused overlay.
      const focused = ui.getFocusedComponent()
      if (focused !== null && focused !== editor) return
      const viewingBackgroundTask = backgroundJobId !== undefined
        || (navigationOwner !== undefined && agent !== navigationOwner)
      if (subagentPanel.isExpanded()) {
        if (matchesKey(data, 'up' as Parameters<typeof matchesKey>[1])) {
          if (subagentPanel.isFirstSelected()) {
            subagentPanel.setExpanded(false)
            editor.setCursorVisible(true)
            ui.setFocus(editor)
          } else {
            subagentPanel.moveSelection(-1)
          }
          ui.requestRender()
          return { consume: true }
        }
        if (matchesKey(data, 'down' as Parameters<typeof matchesKey>[1])) {
          subagentPanel.moveSelection(1)
          ui.requestRender()
          return { consume: true }
        }
        if (matchesKey(data, 'enter' as Parameters<typeof matchesKey>[1])) {
          openBackgroundSelection?.()
          return { consume: true }
        }
        if (matchesKey(data, 'escape') || matchesKey(data, 'left' as Parameters<typeof matchesKey>[1])) {
          if (viewingBackgroundTask) returnToMainAgent?.()
          else {
            subagentPanel.setExpanded(false)
            editor.setCursorVisible(true)
            ui.setFocus(editor)
          }
          ui.requestRender()
          return { consume: true }
        }
        if (!matchesKey(data, 'ctrl+c')) return { consume: true }
      }
      if (viewingBackgroundTask
        && (matchesKey(data, 'escape') || matchesKey(data, 'left' as Parameters<typeof matchesKey>[1]))) {
        returnToMainAgent?.()
        return { consume: true }
      }
      if (matchesKey(data, 'down' as Parameters<typeof matchesKey>[1])
        && subagentPanel.hasEntries()
        && (backgroundJobId !== undefined || (editor.focused && editor.getText() === ''))) {
        subagentPanel.setExpanded(true)
        editor.setCursorVisible(false)
        ui.requestRender()
        return { consume: true }
      }
      if (backgroundJobId !== undefined && !matchesKey(data, 'ctrl+c')) return { consume: true }

      const pastedFile = editor.focused ? pastedImageFilePath(data) : null
      if (pastedFile !== null) {
        try {
          if (statSync(pastedFile).isFile()) {
            void pasteImageFile(pastedFile)
            return { consume: true }
          }
        } catch {
          // Let the editor retain a pasted path that no longer resolves.
        }
      }
      if (editor.focused && isImagePasteShortcut(data)) {
        void pasteClipboardImage()
        return { consume: true }
      }
      if (editor.focused && matchesKey(data, 'alt+up' as Parameters<typeof matchesKey>[1])) {
        const current = agent
        if (current !== undefined && shouldProjectPendingInput(current.status) && recallPendingInput(current)) {
          ui.requestRender()
          return { consume: true }
        }
      }
      const runningKeyAction = runningTurnKeyAction(data, agent?.status, editor.focused, editor.getText())
      if (runningKeyAction === 'clear-draft') {
        editor.setText('')
        ui.requestRender()
        return { consume: true }
      }
      if (runningKeyAction === 'cancel') {
        const current = agent
        if (current !== undefined) {
          recallPendingInput(current)
          current.cancel({ kind: 'user' })
        }
        ui.requestRender()
        return { consume: true }
      }
      if (matchesKey(data, 'ctrl+c')) {
        if (exitArmed) {
          clearTimeout(exitArmTimer)
          exitArmed = false
          ctx.appExit?.(0)
          armExitWatchdog(0)
          return {}
        }
        exitArmed = true
        clearTimeout(exitArmTimer)
        exitArmTimer = setTimeout(() => {
          exitArmed = false
        }, EXIT_ARM_WINDOW_MS)
        if (agent?.status === 'running') {
          agent.cancel({ kind: 'user' })
        } else {
          appendNotice(t('noticeExitHint'), 'info')
        }
        return {}
      }
      if (matchesKey(data, keyTools as Parameters<typeof matchesKey>[1])) {
        toggleTools()
        return {}
      }
      if (matchesKey(data, keyReasoning as Parameters<typeof matchesKey>[1])) {
        toggleReasoning()
        return {}
      }
      if (matchesKey(data, 'pageup' as Parameters<typeof matchesKey>[1])) {
        scrollTranscriptPage(-1)
        return { consume: true }
      }
      if (matchesKey(data, 'pagedown' as Parameters<typeof matchesKey>[1])) {
        scrollTranscriptPage(1)
        return { consume: true }
      }
      // While reading history, Down arrow jumps straight back to the live
      // latest message; otherwise it keeps its normal editor behavior.
      if (matchesKey(data, 'down' as Parameters<typeof matchesKey>[1]) && !chat.followLatest) {
        chat.followLatest = true
        chat.lineOffset = Math.max(0, chat.lastTotalLines - chat.lastViewportLines)
        ui.requestRender()
        return { consume: true }
      }
      return undefined
    })

    // --- mount: run once the configured agent is live -------------------------
    let offEvent: (() => void) | undefined
    let offStatus: (() => void) | undefined
    let offInboxInserted: (() => void) | undefined
    let offInboxDiscarded: (() => void) | undefined
    let offCommandsChange: (() => void) | undefined
    let offSkillsChange: (() => void) | undefined
    let offScheme: (() => void) | undefined
    let offModelSelection: (() => void) | undefined
    let offWechatOutput: (() => void) | undefined
    let activeHandle: AgentHandle | undefined
    let mounted = false

    const mount = (liveAgent: Agent): void => {
      if (mounted) return
      uiMode = modeForSession(ctx.sessionProjections.stateOf(liveAgent.session, 'agentPreset'), resolveDefaultMode())
      mounted = true
      agent = liveAgent
      // 让微信桥跟随 TUI 当前会话；/resume、/new 等切换也走 activateAgent。
      setActiveAgent(liveAgent)
      this.foregroundAgentImpl = () => agent

      const selectionFor = (target: Agent): ModelSelection => {
        const configured = ctx.agentDefaultModel.currentSelection()
        // A fresh Agent still carries the bundle's composition-time provider/model
        // in target.options. Prefer the persisted user default until conversation
        // data establishes a session-local route; resumed sessions are then
        // resolved from their request header below.
        const fallback: ModelSelection = hasConversationData(target.session.snapshotEvents())
          ? {
              provider: target.options.provider ?? configured.provider,
              model: target.options.model ?? configured.model,
              ...configured.reasoningEffort === undefined ? {} : { reasoningEffort: configured.reasoningEffort },
            }
          : configured
        return resolveSessionModelSelection(
          target.session.requestHeader(),
          fallback,
          resolved.defaultReasoningEffort,
        )
      }

      // A historical session continues its last actual request route. A new
      // session starts from the persisted default selection.
      const initialSelection = selectionFor(liveAgent)
      const selectionRef: ModelSelectionRef = { current: initialSelection, assembled: undefined }
      offModelSelection = installModelSelection(liveAgent.ctx, selectionRef)
      const commitSelection = async (selection: ModelSelection): Promise<void> => {
        selectionRef.current = selection
        refreshContextEstimate(agent ?? liveAgent, selection)
        await ctx.agentDefaultModel.saveSelection(selection)
      }
      const saveSelection = async (selection: ModelSelection): Promise<void> => {
        await commitSelection(selection)
        appendNotice(t('noticeModelSet', { provider: selection.provider, model: selection.model }), 'info')
      }
      const setReasoningEffort = async (effort: NonNullable<ModelSelection['reasoningEffort']>): Promise<void> => {
        const selection = selectionRef.current
        if (selection === undefined) throw new Error('model selection unavailable')
        await commitSelection({ ...selection, reasoningEffort: effort })
      }

      const updateTitle = (): void => {
        const current = agent
        const folded = current === undefined ? undefined : foldSessionTitle(current.session.snapshotEvents())
        terminal.setTitle(folded === undefined ? resolved.title : `${folded.title} — ${resolved.title}`)
      }

      header = new HeaderComponent(
        liveAgent,
        () => undefined,
        palette,
        resolved.theme.color && truecolor,
        t,
        () => selectionRef.current,
      )

      // Slash commands + @ / path completions (pi-tui's combined provider
      // scans the workspace rooted at the session cwd).
      const workspace = liveAgent.session.header.cwd ?? process.cwd()
      refreshGitBranch(workspace)
      const themeOptions: AutocompleteItem[] = BUILTIN_THEMES.map(theme => ({
        value: theme.id,
        label: `${theme.id} — ${theme.label}`,
        description: `${theme.scheme} · ${theme.description}`,
      }))
      const builtinCommandEntries: SlashCommand[] = [
        { name: 'palette', description: t('cmdPalette') },
        { name: 'help', description: t('cmdHelp') },
        { name: 'model', description: t('cmdModel') },
        {
          name: 'think',
          description: t('cmdThink'),
          argumentHint: '<level>',
          getArgumentCompletions: async (prefix) => {
            const selection = selectionRef.current
            if (selection === undefined) return null
            try {
              const options: AutocompleteItem[] = (await reasoningEffortsFor(selection)).map(effort => ({
                value: effort.id,
                label: `${effort.id} — ${effort.name}`,
                description: effort.description,
              }))
              return filterCommandOptions(options, prefix)
            } catch {
              return null
            }
          },
        },
        { name: 'new', description: t('cmdNew') },
        { name: 'fork', description: t('cmdFork'), argumentHint: '[name]' },
        { name: 'rename', description: t('cmdRename'), argumentHint: '[name]' },
        { name: 'copy', description: t('cmdCopy') },
        { name: 'reload', description: t('cmdReload') },
        {
          name: 'resume',
          description: t('cmdResume'),
          argumentHint: '<sessionId|name>',
          getArgumentCompletions: async (prefix) => {
            try {
              const records = await ctx.sessionQuery.listSessions()
              const current = agent ?? liveAgent
              const activeWorkspace = current.session.header.cwd ?? process.cwd()
              const persisted = filterResumeSessions(records, activeWorkspace, current.session.id)
              const observations = await ctx.sessionQuery.readTitleSnapshots(
                persisted.map(record => record.header.id),
              )
              const titleById = new Map<string, string>()
              for (const observation of observations) {
                if (observation.status === 'fulfilled' && observation.value.title !== undefined) {
                  titleById.set(String(observation.sessionId), observation.value.title.title)
                }
              }
              const options: AutocompleteItem[] = persisted
                .map(record => {
                  const id = String(record.header.id)
                  const created = new Date(record.header.createdAt ?? 0).toLocaleString()
                  const title = titleById.get(id)
                  return { value: id, label: title === undefined ? id : `${title} — ${id}`, description: created }
                })
              return filterCommandOptions(options, prefix)
            } catch {
              return null
            }
          },
        },
        { name: 'details', description: t('cmdDetails') },
        { name: 'skills', description: t('cmdSkills') },
        {
          name: 'mode',
          description: t('cmdMode'),
          argumentHint: '<preset>',
          getArgumentCompletions: async (prefix) => {
            const roster = ctx.agentPresets
            if (roster === undefined) return null
            try {
              const options = (await roster.list())
                .filter(preset => preset.broken === undefined)
                .map(preset => ({
                  value: preset.id,
                  label: `${preset.id} — ${preset.name ?? modeLabel(t, preset.id, presetNames)}`,
                  description: preset.description,
                }))
              return filterCommandOptions(options, prefix)
            } catch {
              return null
            }
          },
        },
        {
          name: 'theme',
          description: t('cmdTheme'),
          argumentHint: '<mode|dark|light|theme id>',
          getArgumentCompletions: (prefix) => {
            const tokens = prefix.trim().split(/\s+/).filter(Boolean)
            const themeModeOptions: AutocompleteItem[] = [
              { value: 'mode dynamic', label: `mode dynamic — ${t('settingsThemeModeDynamic')}` },
              { value: 'mode selected', label: `mode selected — ${t('settingsThemeModeSelected')}` },
              { value: 'dark', label: `dark — ${t('settingsThemeDark')}` },
              { value: 'light', label: `light — ${t('settingsThemeLight')}` },
            ]
            if (tokens.length === 0) return themeModeOptions
            if (tokens.length === 1) return filterCommandOptions([...themeModeOptions, ...themeOptions], prefix)
            if (tokens[0] === 'mode' && tokens.length === 2) {
              return filterCommandOptions([
                { value: 'dynamic', label: t('settingsThemeModeDynamic') },
                { value: 'selected', label: t('settingsThemeModeSelected') },
              ], tokens[1] ?? '')
            }
            if ((tokens[0] === 'dark' || tokens[0] === 'light') && tokens.length === 2) {
              return filterCommandOptions(themeOptions, tokens[1] ?? '')
            }
            return null
          },
        },
        { name: 'settings', description: t('cmdSettings') },
        { name: 'context', description: t('cmdContext') },
      ]
      const builtinCommandNames = new Set(builtinCommandEntries.map(command => command.name))
      const commandEntries: SlashCommand[] = [...builtinCommandEntries]
      let skillRefreshRevision = 0
      const registeredCommandEntries = (target: Agent): SlashCommand[] => ctx.commands.list(target)
        .filter(command => !builtinCommandNames.has(command.name))
        .map((command): SlashCommand => {
          if (command.name === 'permission') {
            return {
              name: command.name,
              description: t('cmdPermission'),
              argumentHint: permissionCommand.argumentHint,
              getArgumentCompletions: prefix => filterCommandOptions(permissionCommand.options, prefix),
            }
          }
          return {
            name: command.name,
            description: command.description,
            ...command.input === undefined ? {} : { argumentHint: command.input.hint },
          }
        })
      const installAutocomplete = (): void => {
        const base = new CombinedAutocompleteProvider(commandEntries, workspace)
        editor.setAutocompleteProvider(new SkillAwareAutocompleteProvider(base))
        commandHintText = commandInputHint(editor.getText(), commandEntries)
        ui.requestRender()
      }
      observeAutocompleteSelection(editor, {
        onSelection: (text, item) => {
          if (isThemeAutocompleteContext(text) && findTheme(item.value) !== undefined) previewTheme(item.value)
          else clearThemePreview()
        },
        onClose: clearThemePreview,
      })
      const refreshCommandEntries = (): void => {
        const current = agent ?? liveAgent
        const skills = commandEntries.filter(command => command.name.startsWith('skill:'))
        commandEntries.splice(
          0,
          commandEntries.length,
          ...builtinCommandEntries,
          ...registeredCommandEntries(current),
          ...skills,
        )
        installAutocomplete()
      }
      const refreshSkillCommands = async (): Promise<void> => {
        const revision = ++skillRefreshRevision
        try {
          const current = agent ?? liveAgent
          const snapshot = await ctx.skills.snapshot({
            cwd: current.session.header.cwd ?? workspace,
            scope: scopeOf(current.ctx),
          })
          if (revision !== skillRefreshRevision) return
          syncSkillCommands(commandEntries, snapshot.skills)
          installAutocomplete()
        } catch {
          // Keep the current skill command list if the snapshot fails.
        }
      }
      refreshCommandEntries()
      handles.refreshCommands = () => {
        refreshCommandEntries()
        void refreshSkillCommands()
      }
      offCommandsChange = ctx.on('commands/change', refreshCommandEntries)
      offSkillsChange = ctx.on('skills/change', () => { void refreshSkillCommands() })
      void refreshSkillCommands()
      editor.onChange = (text: string): void => {
        commandHintText = commandInputHint(text, commandEntries)
        const candidate = completedThemeCandidate(text)
        if (candidate !== undefined && findTheme(candidate) !== undefined) previewTheme(candidate)
        else clearThemePreview()
        ui.requestRender()
      }

      const offQuestions = ctx.on('user-questions/request', async (request, next) => {
          if (request.agent !== undefined && request.agent.id !== agent?.id) return next()
          orcaStatus.signal({
            kind: 'questions',
            questions: request.questions.map(item => ({
              question: item.question,
              header: item.header,
              multiSelect: item.multiSelect,
              options: item.options?.map(option => ({
                label: option.label,
                description: option.description,
              })),
            })),
          })
          try {
            const bridge = ctx.get('wechat') as WechatBridge | undefined
            if (bridge?.askWithFallback !== undefined) {
              return await bridge.askWithFallback(request, async (r) => ({
                answers: await askInline(r.questions, r.signal),
              }))
            }
            return {
              answers: await askInline(request.questions, request.signal),
            }
          } finally {
            orcaStatus.signal({ kind: 'attention-cleared' })
          }
      })

      // The approval service fails closed when no answerer claims a request.
      // Claim only requests for the foreground agent and render a modal choice.
      /**
       * The argument summary of an already streamed tool call. An approval
       * request carries only `callId`, but Orca's row has to say what is being
       * approved, so the summary is read back off the durable log.
       */
      const pendingToolInput = (target: Agent, callId: ToolCallId | undefined): string | undefined => {
        if (callId === undefined) return undefined
        const events = target.session.snapshotEvents()
        for (let index = events.length - 1; index >= 0; index--) {
          const event = events[index]!
          if (event.type === 'tool/call' && event.data.callId === callId) {
            return toolDetail(event.data.name, event.data.arguments)
          }
        }
        return undefined
      }

      ctx.on('approval/request', async (request, next) => {
        if (request.agent !== agent) return next()
        orcaStatus.signal({
          kind: 'approval',
          toolName: toolLabel(request.toolName),
          toolInput: pendingToolInput(request.agent, request.callId) ?? request.reason,
        })
        try {
          return await runApprovalFlow(
            ui,
            palette,
            t,
            request.toolName,
            request.reason,
            request.signal,
          )
        } finally {
          orcaStatus.signal({ kind: 'attention-cleared' })
          ui.setFocus(editor)
        }
      })

      /** Translate one live session event into an Orca lifecycle fact. */
      const reportOrcaEvent = (event: SessionEvent): void => {
        if (!orcaStatus.active) return
        switch (event.type) {
          case 'user/message':
            // Injected plugin/system context is not what drove the turn.
            if (event.data.source.kind !== 'user') break
            orcaStatus.signal({ kind: 'prompt', text: contentText(event.data.content) })
            break
          case 'assistant/message':
            orcaStatus.signal({ kind: 'assistant', text: contentText(event.data.message.content) })
            break
          case 'tool/call':
            orcaStatus.signal({
              kind: 'tool',
              name: toolLabel(event.data.name),
              input: toolDetail(event.data.name, event.data.arguments),
            })
            break
          case 'turn/end':
            orcaStatus.signal({ kind: 'turn-end', aborted: event.data.reason.kind === 'aborted' })
            break
          default:
            break
        }
      }
      const handleSessionEvent = (targetId: SessionId, session: Session, event: SessionEvent): void => {
        if (session.id !== targetId) return
        try {
          if (event.type === 'session/title') updateTitle()
          renderEvent(event)
          reportOrcaEvent(event)
          updateStatusValues()
          ui.requestRender()
        } catch (error: unknown) {
          appendNotice(t('noticeEventRenderFailed', { error: errorChain(error) }), 'error')
        }
      }
      const handleAgentStatus = (targetId: SessionId, candidate: Agent, status: AgentStatus): void => {
        if (candidate.id !== targetId) return
        try {
          setStatus(status)
          orcaStatus.signal({ kind: 'running', running: status === 'running' })
        } catch (error: unknown) {
          appendNotice(t('noticeEventRenderFailed', { error: errorChain(error) }), 'error')
        }
      }
      /** Announce the state a newly foregrounded session lands in. */
      const reportOrcaSession = (target: Agent): void => {
        orcaStatus.signal({ kind: 'reset' })
        orcaStatus.signal(target.status === 'running'
          ? { kind: 'running', running: true }
          : { kind: 'boundary' })
      }
      const subscribeInbox = (target: Agent): void => {
        offInboxInserted?.()
        offInboxDiscarded?.()
        pendingInputPanel.sync(shouldProjectPendingInput(target.status)
          ? [...target.inbox.nextStep, ...target.inbox.nextTurn]
              .filter(message => !immediateUserMessages.has(message.id))
          : [])
        refreshPendingInput()
        offInboxInserted = ctx.on('agent/inbox/inserted', ({ agent: candidate, message }) => {
          if (candidate !== target
            || immediateUserMessages.has(message.id)
            || !shouldProjectPendingInput(candidate.status)
            || !pendingInputPanel.insert(message)) return
          refreshPendingInput()
        })
        offInboxDiscarded = ctx.on('agent/inbox/discarded', ({ agent: candidate, message }) => {
          if (candidate !== target || !pendingInputPanel.remove(message.id)) return
          refreshPendingInput()
        })
      }
      offEvent = ctx.on('session/event', (session, event) => {
        if (sessionSubagent(event) !== undefined && session.header.parentSession === liveAgent.id) {
          refreshSubagentPanel(liveAgent)
        }
        handleSessionEvent(liveAgent.session.id, session, event)
      })
      offStatus = ctx.on('agent/status', ({ agent: candidate, status }) => {
        if (candidate.session.header.parentSession === liveAgent.id) refreshSubagentPanel(liveAgent)
        handleAgentStatus(liveAgent.id, candidate, status)
      })
      subscribeInbox(liveAgent)

      offScheme = ui.onTerminalColorSchemeChange((scheme) => {
        try {
        currentScheme = scheme
        repaintTheme(previewThemeId, previewThemeId === undefined)
        } catch (error: unknown) {
          appendNotice(t('noticeEventRenderFailed', { error: errorChain(error) }), 'error')
        }
      })

      // Compose fresh sessions from the selected mode without recording an
      // event yet. The persistence gate buffers setup metadata, and the actual
      // preset selection is logged immediately before the first user message.
      async function composeAgentPreset(target: Agent): Promise<void> {
        const presets = ctx.agentPresets
        if (presets === undefined || presets.composedPreset(target.ctx) !== undefined) return
        const recorded = ctx.sessionProjections.stateOf(target.session, 'agentPreset') ?? undefined
        if (recorded === undefined && hasConversationData(target.session.snapshotEvents())) return
        const wanted = recorded ?? uiMode
        try {
          await presets.mount(target.ctx, wanted)
        } catch (error: unknown) {
          appendNotice(t('noticeModeMountFailed', { error: errorChain(error) }), 'error')
        }
      }

      const activateAgent = (next: Agent, handle: AgentHandle | undefined): void => {
        const previousHandle = activeHandle
        offEvent?.()
        offStatus?.()
        // A foreground switch starts a new activity clock even when both agents are running.
        stopSpinner()
        offInboxInserted?.()
        offInboxDiscarded?.()
        offModelSelection?.()
        const nextSelection = selectionFor(next)
        selectionRef.current = nextSelection
        selectionRef.assembled = undefined
        uiMode = modeForSession(ctx.sessionProjections.stateOf(next.session, 'agentPreset'), resolveDefaultMode())
        offModelSelection = installModelSelection(next.ctx, selectionRef)
        const editorText = editor.getText()
        const textWithoutImages = imagePasteDraft.discardFrom(editorText)
        if (textWithoutImages !== editorText) editor.setText(textWithoutImages)
        activeAgentGeneration += 1
        agent = next
        activeHandle = handle
        setActiveAgent(next)
        applyStartupPermission(next)
        handles.refreshCommands?.()
        tokenTotals = { inputTokens: 0, outputTokens: 0 }
        contextUsageCache.measuredAt = 0
        refreshContextEstimate(next, nextSelection)
        refreshGitBranch(next.session.header.cwd ?? process.cwd())
        header = new HeaderComponent(
          next,
          () => undefined,
          palette,
          resolved.theme.color && truecolor,
          t,
          () => selectionRef.current,
        )
        offEvent = ctx.on('session/event', (session, event) => {
          if (sessionSubagent(event) !== undefined && session.header.parentSession === next.id) {
            refreshSubagentPanel(next)
          }
          handleSessionEvent(next.session.id, session, event)
        })
        offStatus = ctx.on('agent/status', ({ agent: candidate, status }) => {
          if (candidate.session.header.parentSession === next.id) refreshSubagentPanel(next)
          handleAgentStatus(next.id, candidate, status)
        })
        subscribeInbox(next)
        rebuildTranscript()
        live = true
        setStatus(next.status)
        reportOrcaSession(next)
        updateTitle()
        warnIfFullAccess(next)
        void composeAgentPreset(next).then(() => { handles.refreshCommands?.() })
        if (previousHandle !== undefined && previousHandle !== handle) {
          // 延迟到当前命令/事件生命周期写完再释放旧句柄；微信侧
          // `@dsh new` 会从旧 agent 的命令执行中直接切换前台会话。
          // 用 setImmediate 而不是 queueMicrotask：命令执行器在 handler
          // 返回后还需要往旧 session 追加 command/done，不能在微任务里先 dispose。
          setImmediate(() => {
            void previousHandle.dispose().catch(() => undefined)
          })
        }
      }

      returnToMainAgent = () => {
        const root = navigationOwner
        backgroundJobId = undefined
        backgroundJobView.set(undefined)
        subagentPanel.setViewing(undefined)
        subagentPanel.setExpanded(false)
        editor.setCursorVisible(true)
        if (root !== undefined && agent !== root) activateAgent(root, activeHandle)
        navigationOwner = undefined
        refreshSubagentPanel(root ?? agent)
        rebuildChrome()
        ui.requestRender()
      }

      openBackgroundSelection = () => {
        const selection = subagentPanel.selected()
        const root = navigationOwner ?? agent
        if (selection === undefined || root === undefined) return
        navigationOwner = root
        subagentPanel.setExpanded(false)
        editor.setCursorVisible(true)
        if (selection.kind === 'subagent') {
          const id = selection.descriptor.id
          const child = id === undefined ? undefined : ctx.agents.get(SessionId(id))
          if (child === undefined) {
            appendNotice('Subagent is no longer available', 'warning')
            refreshSubagentPanel(root)
            return
          }
          backgroundJobId = undefined
          backgroundJobView.set(undefined)
          subagentPanel.setViewing({
            kind: 'subagent',
            label: selection.descriptor.label ?? selection.descriptor.provider,
          })
          if (agent !== child) activateAgent(child, activeHandle)
          rebuildChrome()
          ui.requestRender()
          return
        }

        if (agent !== root) activateAgent(root, activeHandle)
        backgroundJobId = selection.descriptor.id
        backgroundJobView.set(selection.descriptor)
        subagentPanel.setViewing({ kind: 'job', label: selection.descriptor.label })
        refreshSubagentPanel(root)
        rebuildChrome()
        ui.requestRender()
      }

      const createAgent = async (): Promise<SessionId | undefined> => {
        const current = agent ?? liveAgent
        const selection = selectionRef.current ?? selectionFor(current)
        const preset = uiMode
        const id = SessionId(`tui-${crypto.randomUUID()}`)
        const handle = await ctx.agents.create({
          sessionId: id,
          meta: {
            cwd: current.session.header.cwd ?? process.cwd(),
            agentPreset: preset,
          },
          agentOptions: {
            ...current.options,
            provider: selection.provider,
            model: selection.model,
          },
          setup: async (agentCtx) => { await ctx.agentPresets.mount(agentCtx, preset) },
        })
        // `/new` should continue the current session's permission instead of
        // falling back to the global startup default.
        const currentPermission = ctx.permissionPresets.current(current.session)
        if (currentPermission !== 'custom') {
          try {
            ctx.permissionPresets.set(handle.agent.session, currentPermission)
          } catch {
            // If the preset cannot be applied, the new session keeps the default.
          }
        }
        activateAgent(handle.agent, handle)
        appendNotice(t('noticeSessionCreated', { id: String(id) }), 'info')
        return id
      }

      const forkAgent = async (requestedTitle?: string): Promise<SessionId | undefined> => {
        const current = agent ?? liveAgent
        const selection = selectionRef.current ?? selectionFor(current)
        const preset = uiMode
        const id = SessionId(`tui-${crypto.randomUUID()}`)
        const seed = current.session.snapshotEvents()
        const handle = await ctx.agents.create({
          sessionId: id,
          seed,
          inheritedEventCount: SessionLogOffset(seed.length),
          meta: {
            cwd: current.session.header.cwd ?? process.cwd(),
            parentSession: current.session.id,
            isSeeded: true,
            agentPreset: preset,
          },
          agentOptions: {
            ...current.options,
            provider: selection.provider,
            model: selection.model,
          },
          setup: async (agentCtx) => { await ctx.agentPresets.mount(agentCtx, preset) },
        })
        try {
          const currentPermission = ctx.permissionPresets.current(current.session)
          if (currentPermission !== 'custom') {
            try {
              ctx.permissionPresets.set(handle.agent.session, currentPermission)
            } catch {
              // If the preset cannot be applied, the fork keeps the default.
            }
          }
          const inheritedTitle = foldSessionTitle(current.session.snapshotEvents())?.title
          const forkTitle = requestedTitle ?? (inheritedTitle === undefined ? undefined : `${inheritedTitle} (fork)`)
          if (forkTitle !== undefined) ctx.sessionTitle.rename(handle.agent.session, forkTitle)
        } catch (error: unknown) {
          await handle.dispose().catch(() => undefined)
          throw error
        }
        activateAgent(handle.agent, handle)
        appendNotice(t('noticeSessionForked', { id: String(id), parent: String(current.session.id) }), 'info')
        return id
      }
      this.createForegroundSessionImpl = createAgent
      setTuiForegroundControl({
        foregroundAgent: () => this.foregroundAgent(),
        createForegroundSession: () => this.createForegroundSession(),
      })

      const switchAgent = async (targetId: SessionId): Promise<void> => {
        const current = agent ?? liveAgent
        if (current.id === targetId) {
          appendNotice(t('noticeAlreadySession'), 'info')
          return
        }
        try {
          const workspace = current.session.header.cwd ?? process.cwd()
          const records = await ctx.sessionQuery.listSessions()
          const allowed = records.some(record =>
            record.persisted && String(record.header.id) === String(targetId) && sameProject(record.header.cwd, workspace))
          if (!allowed) {
            appendNotice(t('noticeNoSessions'), 'warning')
            return
          }
        } catch (error: unknown) {
          appendNotice(t('noticeSessionListFailed', { error: errorChain(error) }), 'error')
          return
        }
        const existing = ctx.agents.get(targetId)
        if (existing !== undefined) {
          appendNotice(t('noticeResuming'), 'info')
          activateAgent(existing, undefined)
          appendNotice(t('noticeSessionResumed', { id: String(targetId) }), 'info')
          return
        }
        appendNotice(t('noticeResuming'), 'info')
        const presets = ctx.agentPresets
        const controller = new AbortController()
        const resumePromise = ctx.agents.resume({
          resumeSessionId: targetId,
          agentOptions: current.options,
          signal: controller.signal,
          setup: presets === undefined ? undefined : async (agentCtx) => {
            const resumed = agentCtx.agent
            const recorded = resumed === undefined
              ? undefined
              : ctx.sessionProjections.stateOf(resumed.session, 'agentPreset') ?? undefined
            if (recorded !== undefined) await presets.mount(agentCtx, recorded)
          },
        })
        // Keep the original promise's late rejection from becoming unhandled if
        // the timeout wins the race, and dispose a handle that only arrives late.
        let timedOut = false
        let settled = false
        void resumePromise.then((handle) => {
          if (timedOut) void handle.dispose().catch(() => undefined)
        }).catch(() => undefined)
        let resumeTimer: NodeJS.Timeout | undefined
        const timeoutPromise = new Promise<AgentHandle>((_, reject) => {
          resumeTimer = setTimeout(() => {
            controller.abort()
            if (!settled) {
              timedOut = true
              reject(new DOMException('Session resume timed out', 'AbortError'))
            }
          }, RESUME_TIMEOUT_MS)
        })
        try {
          const handle = await Promise.race([resumePromise, timeoutPromise])
          settled = true
          clearTimeout(resumeTimer)
          activateAgent(handle.agent, handle)
          appendNotice(t('noticeSessionResumed', { id: String(targetId) }), 'info')
        } catch (error: unknown) {
          settled = true
          clearTimeout(resumeTimer)
          const aborted = error instanceof Error && error.name === 'AbortError'
          appendNotice(
            aborted ? t('noticeResumeTimeout') : t('noticeResumeFailed', { error: errorChain(error) }),
            'error',
          )
        }
      }

      // Publish model helpers before the first status render; otherwise the
      // initial frame briefly shows Agent creation defaults instead of the
      // selection that will actually route the next request.
      handles.newAgent = createAgent
      handles.forkAgent = forkAgent
      handles.switchAgent = switchAgent
      handles.saveSelection = saveSelection
      handles.setReasoningEffort = setReasoningEffort
      handles.selectionRef = selectionRef
      refreshContextEstimate(liveAgent, initialSelection)

      applyStartupPermission(liveAgent)
      // Replay the durable log first (constructor seeds never publish), then
      // go live so turn-end notices only surface for fresh work.
      rebuildTranscript()
      // Attach after the transcript rebuild so buffered startup output is not
      // cleared by the replay and stays visible as persistent cards.
      subscribeWechatOutput()
      live = true
      updateTitle()
      setStatus(liveAgent.status)
      reportOrcaSession(liveAgent)
      void composeAgentPreset(liveAgent).then(() => { handles.refreshCommands?.() })
      void (async () => {
        const presets = ctx.agentPresets
        if (presets === undefined) return
        try {
          for (const preset of await presets.list()) {
            presetNames.set(preset.id, preset.name ?? preset.id)
          }
        } catch {
          // Roster unreadable: keep the shipped labels.
        }
        updateStatusValues()
        ui.requestRender()
      })()
      ui.start()
      // Do not enable mouse tracking. The terminal retains native wheel,
      // selection, click, and copy behavior.
      warnIfFullAccess(liveAgent)

    }

    const readyAgent = ctx.agents.get(sessionId)
    if (readyAgent !== undefined) {
      mount(readyAgent)
    } else {
      const offCreated = ctx.on('agent/created', ({ agent: candidate }) => {
        if (candidate.id === sessionId) {
          offCreated()
          mount(candidate)
        }
      })
      const timeout = setTimeout(() => {
        if (mounted) return
        offCreated()
        terminal.write(`\r\ntui: session "${sessionId}" never became live (timed out).\r\n`)
        ctx.appExit?.(1)
      }, AGENT_READY_TIMEOUT_MS)
      ctx.effect(() => () => {
        clearTimeout(timeout)
      })
    }

    ctx.effect(() => () => {
      setTuiForegroundControl(undefined)
      imagePasteDisposed = true
      imagePasteDraft.clear()
      offKeys()
      offEvent?.()
      offStatus?.()
      offInboxInserted?.()
      offInboxDiscarded?.()
      offCommandsChange?.()
      offSkillsChange?.()
      offScheme?.()
      offModelSelection?.()
      offWechatOutput?.()
      stopSpinner()
      clearTimeout(exitArmTimer)
      ui.stop()
      terminal.stop()
    })
  }
}

export { SessionId }
export default Tui
