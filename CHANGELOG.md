# Changelog

## Unreleased

## [0.6.7] - 2026-09-09

- 修复 `/resume` 选择器把当前会话作为默认候选、以及后台任务全局按键处理可能吞掉覆盖层 Enter/方向键的问题。
- 新增 `/fork [name]` 与 `/rename [name]`；`/resume [id|name]` 支持使用重命名后的唯一名称恢复会话，并在补全和选择器中展示标题。
- 新增打包后的 ConPTY 会话操作验收，覆盖历史继承、重命名、选择器恢复和按名称恢复。

## [0.6.3] - 2026-08-28

- 普通 `omdsh` 启动不再因全局 launcher 比 Profile 新而自动打包、安装；版本查询与升级仅由显式 `omdsh update` 执行。

## [0.6.2] - 2026-08-28

- 修复 `omdsh update` 因 GitHub API 未认证限流返回 HTTP 403：更新源改为 npm `latest` dist-tag，并在安装前校验 registry 提供的 SHA-512 integrity。

## [0.6.1] - 2026-08-28

- 新增行首 `!` shell 输入：复用 dsh 当前平台的 sandbox shell executor，命令运行中与结果显示为聊天工具卡；完成后将命令、stdout、stderr 和退出状态作为持久用户消息开启独立 agent 回合。
- 将产品、GitHub 仓库和 npm bundle 统一为 `omdsh` / `yoke233/omdsh` / `@yoke233/omdsh`；启动器即使检测到当前版本已正确安装，也会先移除残留的旧 `dsh-omp-tui` bundle，避免 Profile 同时加载新旧补丁。
- 新增 `omdsh update [--force]`：从 GitHub 最新 Release 下载 `yoke233-omdsh-<version>.tgz` 到持久化 Profile 包目录，校验 GitHub 提供的 SHA-256 摘要后安装并核对版本。
- 修复技能和普通斜杠命令补全的重复提示，以及 Tab 完成命令后不立即切换参数候选的问题。
- 展示模型请求的持久重试进度：退避等待期间显示 `重试 N/M` 与等待时长，最终错误卡片显示本步骤的第几次尝试。
- 修复 `/reload` 在旧进程 300ms 内快速退出时可能漏掉“正在重启”提示的监督进程竞态。
- 修复主输入区偶发失去焦点后中英文按键不再送达的问题：无弹框或后台导航占用输入时，在按键分发前恢复原生 pi-tui `Editor`，并保留触发恢复的首个字符。

## [0.5.11] - 2026-08-27

- 将执行中与已完成的工具卡统一为单行 `图标 · 输入摘要 · 输出摘要` 布局，仅在用户按 `Ctrl+O` 时展开；保留 REPL dispatch 包装卡和嵌套子工具，避免工具完成时高度骤降并留下大块终端空白。
- 增强 Background tasks 导航与待处理输入面板：支持进入后台 Agent/Job 视图、返回主 Agent，并为 Steering 队列提供完整宽度的主题背景和紧凑编辑提示。
- 将无边框输入框迁移为仓库内基于公开 API 的 `PromptEditor`，删除 `@earendil-works/pi-tui` pnpm patch、vendored notice 及对应发布配置。
- 用户可见的错误码移除上游 `PI_` 命名空间前缀，例如 `PI_AI_ERROR` 显示为 `AI_ERROR`。

## [0.5.7] - 2026-08-26

- 简化 `omdsh` 重载提示为单行“正在重启 TUI 并恢复当前会话”；当 Profile bundle 版本高于全局启动器时静默跳过 bootstrap，不再显示与 reload 无关的版本比较或“避免降级”提示。

## [0.5.6] - 2026-08-26

- 调整运行中任务的取消键行为：Ctrl+C 在输入框非空时只清空当前草稿，不中断任务；输入框为空时 Ctrl+C 或 Esc 会先把全部 Steering 队列消息按顺序恢复到输入框，再取消当前任务。新增源码行为测试和打包后 Ctrl+C/Escape ConPTY 验收。

## [0.5.5] - 2026-08-26

- 升级开发工具链到 TypeScript 7、Node.js 26 类型定义和 `@earendil-works/pi-tui` 0.84.3；将主屏构造迁移到 `TuiMainScreen`，并把无边框提示符编辑器补丁重放到新版 pi-tui。
- 支持 dsh 官方 `tool/code-dispatch-start` / `tool/code-dispatch` 子调用协议：`repl` 与 `run_code` 内的工具调用按 parent/sub-call id 嵌套显示，并通过当前工具的 `presentCall` / `presentResult` 复用标准 diff 等视图；`apply_patch` 与 `edit` 不再退化为一整块 REPL 文本。
- 新增 Orca pane 内的 agent 状态上报（OSC 9999）：Orca 左侧 workspace 列表现在会显示这个会话那一行（`● Working – DSH` / `✓ Done – DSH`）。新增 `src/orca-status.ts`（序列化 + 状态机，字节直写 stdout 绕开差分渲染器），由 `ORCA_PANE_KEY` 门禁，普通终端下完全静默；上报 `prompt` / `toolName` / `toolInput` / `lastAssistantMessage` / `model` / `interrupted` / `sessionBoundary`，权限确认与提问统一上报 `waiting` 且必带在批准什么，选项式提问附 `interactivePrompt` 让 Orca 渲染成可点击卡片。新增 `tests/orca-status.spec.ts` 与 ConPTY 验收场景 `orca-status`，文档见 `docs/orca.md`
- 修复模型请求网络异常、上游 429、重试耗尽等回合错误仅在 notice 区域显示的问题：错误现在作为持久卡片进入 transcript 列表，并在会话重绘时按原顺序恢复。新增打包后 ConPTY 场景 `error-persistence`，验证错误位于后续回合之前且 6 秒后仍在当前界面
- 修复 `omdsh` 用 `file:` 目录引导安装时被 pnpm 记录为 `link:`、导致 `cordis.patch.yml` 引用的运行依赖未安装到 Profile 根目录：启动器现在先生成 `.tgz` 再安装，发现同版本 Profile 缺少直接运行依赖时会自动修复，并在 Windows 更新前解除旧目录链接
- 精简工具调用显示：成功的 REPL dispatch 只保留具体子工具卡，Ctrl+O 改为紧凑折叠与完整展开两态，不再隐藏工具；`apply_patch` 解析为按文件分组、使用当前主题增删色的 Patch 视图。
- 新增 Background tasks 面板：汇总子 Agent 的 running/idle 状态和 running/stopping Jobs，空编辑器按 ↓ 展开、按 ← 返回主界面，并移除 footer 中重复的 Jobs 计数。
- 新增打包后 ConPTY 验收场景，覆盖工具卡两态切换、Patch 渲染、子 Agent 导航与 Jobs 导航。

## [0.5.0] - 2026-08-24

- 修复 `/reload`（及 Ctrl+C 双击退出）可能永久卡死：launcher 的有界关闭在 dispose 成功后仅设置 `process.exitCode` 等事件循环自然排空（5s 强杀定时器已被清除），第三方 bundle 泄漏的 keep-alive handle 会让进程永不退出、壳等不到退出码。现在退出请求后加挂 unref 看门狗（`armExitWatchdog`，10s）：干净退出不受影响，泄漏场景最坏 10 秒后强制退出并照常 respawn
- 重新启用 `/reload`，改为监督进程 + 世代重启实现（不修改 deepseek-harness）：`omdsh` 作为稳定监督进程，TUI `/reload` 把下一代内层参数写入 handoff 文件并经 `ctx.appExit(75)` 优雅退出，`omdsh` 在同一终端重启新一代 dsh 进程并以 `--resume` 续接当前会话；任意插件升级、`link:` 代码变化、依赖变化随新进程模块图生效。直接 `dsh --profile tui` 启动时 `/reload` 提示需要 `omdsh` 并拒绝。新增 `src/respawn.ts` 契约模块、`tests/respawn.spec.ts` 单测与 ConPTY 验收场景 `reload-respawn`（断言 dsh PID 更换、监督进程不变、已安装代码修改生效、`--resume` 命令行续接）
- 新增 `/context` 全屏上下文用量检查器：显示模型窗口占用、分类明细、块状地图，并支持导航、预览、缩放与 `Esc` 返回
- 升级 dsh 宿主、运行时与开发依赖到 `0.1.1-rc.2`，并同步本地开发与安装文档
- 暂时关闭实验性的 `/reload` 与 `tui-reload` Profile 行；调查源码和测试保留，Profile 或代码变化需重启 TUI 后生效
- 编辑框普通消息默认通过 `steer` 进入最近 step；提交后在待处理面板即时回显，写入正式 `user/message` 后自动移入 transcript

## [0.2.3] - 2026-08-20

- 升级 dsh 宿主依赖与开发依赖到 `0.1.0-rc.8`：适配 `commands.execute(agent, line, images, signal)` 新签名，TUI 与微信命令路径统一传入空图片批次
- 移除失效的 `@deepseek-ai/dsh-llm` pnpm patch（原 patch 只改 `lib/types/assembler.js`，实际主入口 `lib/index.js` 未被修复）；改为 TUI 侧 `llm/stream` 流式消毒器，在 `tool-call-delta` / `block-end` 进入 BlockAssembler 前把空 `id`/`name` 替换为 `call-<index>` / `unknown`
- 在会话持久化读写边界修复历史异常工具调用：包装 JSONL backend 的 `appendBatch` 与 `loadStored`，对 `tool/call`、`tool/result`、`assistant/message` 中的空 `callId`/`name`/`arguments` 做规范化，使存在空工具 id 的存量会话可被恢复
- 工具卡空名称显示回退为 `Unknown`，不再出现空白标题
- 新增回归测试：空工具 id 的损坏会话可 `Session.fromRestore` 恢复；空工具名工具卡回退渲染

## [0.2.2] - 2026-08-20

- 修复上下文压缩进度提示仅 5s 瞬时消失：`compaction/start` 置 `isCompacting` 并经 `indicator` 持久显示 `上下文压缩中…`，`compaction/end` 清除，与 `running` 旋钮互斥，且在 `rebuildTranscript` 时按事件重建
- 修复压缩后插入的上下文卡片无法展开：`ContextCardComponent` 增加 `collapsed/expanded` 状态并接入 `Ctrl+O` 全局显隐循环，`maxOutputLines` 截断时持久提示 `… +N lines (Ctrl+O to expand)`
- 修复压缩后上下文用量仍显示旧长度：`compaction/end` 强制 `contextUsageCache.measuredAt=0` 触发 `tokenMeter.measure` 立即重算，`rebuildTranscript` 重建时同步 `isCompacting` 状态
- 修复超长会话恢复失败：`BlockAssembler` 空 `tool-call` 覆盖导致 `tool/result callId:""` 持久化后 `Session.fromRestore` 拒识，补丁忽略空 `id/name` 并回退 `block-end`，`repair-sessions.py` 按 `(turn,step)` 回填并重建多帧 `zstd`（`tui-695e` 86 帧、`tui-edaa` 截断至 233797 事件），`79` 会话校验 0 fail
- 修复非官方接入点 `/compact` 400：`pi-ai openai-completions isDeepSeek` 扩展至 `deepseek-official` 与 `model.id`，`dsh-compaction-basic summarizeWithLlm` 增加 `configured/latest/agentTarget` 回退，`cordis.patch.yml` 保留 `deepseek-official/deepseek-v4-flash` 并提升 `AGENT_READY_TIMEOUT 10s→30s`
- 将 `AGENT_READY_TIMEOUT_MS` 提升至 `30s` 并重建多帧存储以避免 `persistence.list()` 首帧 8k 未命中导致的启动超时

## [0.2.1] - 2026-08-18
- Port all 98 concrete OMP themes from the local OMP installation into `src/theme-data.ts`; `/theme` and settings now list every dark, light, and neutral OMP theme with no preset family groups.
- Rework theme selection into `dynamic` (dark/light slots chosen independently, follows the terminal scheme) and `selected` (one fixed theme); the dark slot may hold a light theme and vice versa.
- Truecolor light schemes now use the light-slot OMP theme instead of falling back to ANSI colors.
- `omdsh` now automatically updates the tui profile when the installed plugin version is older than the launcher version.
- Cache rendered transcript rows per component and throttle token-meter/permission reads to once per second, fixing the progressive slowdown as session history grows.
- Tool cards now keep the title as the bare tool name and show the actual command or query in an `Input` section above `Output` for `pwsh`, `bash`, `read`, `write`, `edit`, `grep`, `glob`, `web_search`, `web_fetch`, and `run_code`; long commands wrap instead of truncating.
- `str_replace_editor` renders `old_str`/`new_str` as a diff section (red removals, green additions) instead of hiding the edit content.
- Wrap session-event rendering in try/catch error notices so one malformed event cannot crash the TUI.
- Add Linux CI E2E smoke test (`dsh --profile tui` boots, renders `/help`) and WeChat command/config unit tests.
- Add settings UI for per-role RGB theme overrides, status prompt templates, and tool/reasoning keybindings; add a subagent descriptor panel.

## [0.2.0] - 2026-08-18

- Fix WeChat inbound routing to always follow the foreground TUI session; only send the "task in progress" receipt after the message is successfully queued.
- `@dsh new` now creates a session through the TUI and brings it to the foreground instead of switching the WeChat bridge to a background session.
- Replace the `dsh` wrapper with an `omdsh` launcher that uses the system `dsh` from PATH and bootstraps the tui profile on first run.
- 将 dsh 宿主 peer 依赖标记为 optional，避免 npm 11 全局安装启动器时因 peer 图触发 Arborist 的 `null.children` 崩溃。

## [0.1.3] - 2026-08-17

- Fix WeChat inbound routing after TUI session switches: `/resume` and `/new` now update the WeChat bridge's active-agent pointer, so ordinary WeChat messages are steered into the currently visible TUI session instead of an old background session.
- Fix `/model` and the settings default/title model pickers to include models configured on user-added providers in the provider settings screen, instead of only querying the live LLM registry.
- The settings screen now writes custom provider profiles through the official `llm-pi-ai` settings namespace and lets the dsh adapter own registration and runtime requests; it does not implement a second LLM adapter.
- Decouple WeChat start/result notifications from the progress-reporting switch: turning progress reporting off now disables only periodic progress reports, while the "task in progress" start receipt and final result/error push remain enabled.
- Improve provider model management: long Base URLs and model IDs show complete wrapped details, model lists support add/edit/delete with transactional Save/Cancel, and Delete/Backspace removes the highlighted model instead of implicitly deleting the last entry.
- Fix the model catalog dialog on narrow terminals: help text, model IDs, selected values, errors, and footer hints now wrap within the frame instead of being clipped.

## [0.1.2] - 2026-08-16

- Migrate the OMP WeChat (iLink) bridge into dsh as a first-class bundle service: `/wechat-*` commands, `@dsh` remote commands, `wechat_send`/`wechat_status` tools, automatic progress/result push, and WeChat-aware ask bridging.
- Optimize overlay dialogs: center them by default, enlarge ask/user-question dialogs to 90% width/height, and enlarge general dialogs to 80% width/85% height so content is less likely to be folded.
- Add a default config section in `/settings` for startup permission mode, model, and reasoning effort; `/new` now continues the current session's permission instead of the global default.
- Rework `/settings` around OMP's full-screen framed layout: tabbed label/value rows, preserved cursors, current-value preselection, nested Escape-to-back navigation, and stale async-view guards.
- Expand `/settings` with more configurable items: show reasoning, tool output lines, default mode, max parallel tool calls, custom provider/model entries (with editing of saved custom IDs), and move default model/effort onto the Model tab with visible Provider/Model rows.
- Add a single-page custom model form: provider, model, and reasoning effort are shown together with save-target checkboxes and Save/Cancel actions, so no more one-field-per-screen wizard.
- Reorganize `/settings` into General / Models & Providers / Advanced tabs; provider editing/creation now uses the official dsh-llm-pi-ai protocol values `openai-completions`, `openai-responses`, and `anthropic-messages`, with Base URL, API key, model discovery, manual model entry, and preset templates persisted through dsh settings.
- Fix default mode persistence: `/settings` 中保存的 `agent-presets.default` 现在会在新会话启动时生效，不再固定回退到 `standard`。
- Expose each skill as a `skill:<name>` quick command in the composer, so typing `/` lists them and fuzzy search can find them by partial names (e.g. `commit` → `skill:git-commit`); completion keeps the no-space syntax.
- Sanitize ANSI/C1 escape sequences and tabs from session, tool, and todo text before differential rendering to prevent colored blocks, cursor movement, and frame corruption.
- Add a `微信claw` tab in `/settings` for WeChat progress reporting, progress interval, and terminal-task push configuration.
- Fix WeChat send tool return shape so empty messages and omitted `to` fields are represented cleanly.

## [0.1.1] - 2026-08-15

- Add `/new` for in-process fresh-session creation.
- Keep abandoned sessions unmaterialized until they contain conversation data.
- Submit exact slash-command arguments, including `/mode minimal`, with one Enter press.
- Add `/think [level]` with model-specific effort completion, cycling, and persistence.
- Wrap the mode, path, and Git prompt in one OMP-style dark Powerline surface.
- Discover and switch any locally installed agent preset via `/mode`.
- Advertise the configured `/permission` modes in help, inline hints, and argument completion, with localized built-in descriptions.
- Make narrow sidebars use coherent compact status segments and keep permission state visible after context usage.
- Sanitize carriage returns from shell output so multiline tool cards keep their borders intact.
- Present the unrestricted permission preset as `full-access`, show a startup reminder when it is active, and highlight it with the theme's emphasis color.
- Harden session resume: avoid quadratic transcript rebuilds, make Git branch reads non-blocking, cap resume/title loading with timeouts, and surface resume failures.
- Keep the hardware cursor visible in the editor so IMEs that preview pinyin/composition text place it inline at the cursor instead of at the line end.
- Cap the compact mode segment to 4 CJK / 8 ASCII columns with an ellipsis so long preset ids like `anchored-standard` stay compact.
- Rework the footer compression order: compress the model with a middle ellipsis first, then drop the `ctx` prefix, and only then remove lower-priority segments.

## [0.1.0] - 2026-08-14

- Initial public dsh profile bundle.
- OMP-styled Catppuccin terminal layout with responsive welcome panel.
- Chronological user, injected-context, assistant, reasoning, and tool rendering.
- GitHub Release tarball workflow for reproducible profile installation.
