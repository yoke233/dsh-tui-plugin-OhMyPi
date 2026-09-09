# @yoke233/omdsh 合约速查表（contracts.md）

> dsh 0.1.2-alpha.2 唯一真相源。类型文本逐字引自 npm 安装包
> `@deepseek-ai/*/lib/types/*.d.ts`。本文件是 TUI bundle 消费 harness 服务的地图；
> 上游接口变更时先更新本表再改代码。
> 包根：`node_modules/@deepseek-ai`（本仓库 pnpm 安装）与全局 dsh 安装目录中的 `node_modules/@deepseek-ai`
> Bundle 包身份为 `@yoke233/omdsh`，Profile 名保持 `tui`；重命名不改变 `tui`、`tui-startup`、`tui-prompt`、`session-title-llm-tui`、`wechat-ilink`、`tui-reload` 等行 id，以保留设置与会话兼容性。旧 `dsh-omp-tui` 与新 bundle 不得同时出现在一个 Profile。

---

## 1. 会话与事件 — `@deepseek-ai/dsh-session`

### 1.1 SessionEventMap（append-only 事件日志，事件源真相）

```ts
export interface SessionEventMap {
  'turn/start': { turn: number };
  'turn/end': { turn: number; reason: TurnEndReason };
  'step/start': { turn: number; step: number };
  'step/end': { turn: number; step: number };
  'user/message': UserMessage;           // 直接人类提示 / 注入上下文 / goal 续轮；data.source 区分
  'assistant/chunk': { turn: number; step: number; chunk: StreamChunk };
  'assistant/message': { turn: number; step: number; message: AssistantMessage; usage?: TokenUsage; interrupted?: true };
  'tool/call': { turn: number; step: number; callId: ToolCallId; name: string; arguments: string };
  'tool/result': { turn: number; step: number; message: ToolResultMessage; error?: { name: string; code: string }; meta?: JsonValue };
  // dsh-tool-todo 合并 'todo/write'；整表快照，后写覆盖，仅 UI 状态，不进派生历史
  'tool/code-dispatch-start': PtcDispatchStartEventData; // REPL/PTC nested call starts
  'tool/code-dispatch': CodeDispatchEventData;            // matching nested call settlement
  'request/header': { header: EpochHeader; reason: RequestHeaderReason };
  'request/context': RequestContext;
  'session/end-seed': Record<string, never>;
  // 插件合并扩展：dsh-agent 追加 'agent/inbox/spliced'；compaction/goal 各自追加（见 §7）
}
```

插件扩展方式：`declare module '@deepseek-ai/dsh-session/types' { interface SessionEventMap { ... } }`。

`@deepseek-ai/dsh-llm-retry` 追加持久但默认不进入表层的 `llm/retry` 与 `llm/retry-started`。`llm/retry` 数据包含 `turn`、`step`、`provider`、从 1 开始的 `retry`、实际 `delayMs`、失败详情；normal 模式另含 `maxRetries`。提供方省略策略时默认 normal 模式：首次请求失败后最多重试 5 次（总计最多 6 次尝试），仅 `EMPTY_RESPONSE`、`RATE_LIMIT`、`SERVER`、`TIMEOUT`、`TRANSPORT` 可重试。局部退避为 500ms 起始、2 倍指数、10s 封顶，并施加 ±10% jitter；若提供方返回不超过 10s 的有效 Retry-After，则优先采用。

已知团队事件（log-only，TUI 默认忽略）：`team/member`、`team/message/delivered`、`team/message/queued`、`team/task`。

`@deepseek-ai/dsh-tools` 对上述两个 log-only 事件声明合并：

```ts
interface PtcDispatchStartEventData {
  rootCallId: ToolCallId;
  parentCallId: ToolCallId;
  subCallId: ToolCallId;
  name: string;
  arguments: unknown;
}
interface PtcDispatchEventData extends PtcDispatchStartEventData {
  isError: boolean;
  content: ContentBlock[];
}
```

TUI 必须按 `subCallId` 配对 start/settlement，并按 `parentCallId` 挂到父工具卡；缺失 start 的 settlement 仍携带完整 name/arguments/content，必须可回退渲染。调用与结果视图通过当前 Agent catalog 中同一 `ToolDefinition.presentCall` / `presentResult` interface 推导，不能发明 TUI 私有 metadata。Prime `repl` 与官方 `run_code` 都写入这套事件，因此 Web/TUI 消费同一协议。

### 1.2 TurnEndReason

```ts
export interface TurnEndReasonMap {
  completed: { kind: 'completed' };
  aborted: { kind: 'aborted'; reason: TurnEndCancelCause };   // user|parent|hook|disposed|legacy
  blocked: { kind: 'blocked' };
  error: { kind: 'error'; error: LlmFailure };
  'max-tokens': { kind: 'max-tokens' };
  interrupted: { kind: 'interrupted' };                        // 崩溃孤儿轮次，重启时由持久化后端闭合
}
```

### 1.3 SessionEvent 信封（判别联合，switch 收窄）

```ts
export type SessionEvent<T extends SessionEventType = SessionEventType> = {
  [K in SessionEventType]: {
    type: K;
    seq: number;        // 单调连续 = log.length
    time: number;       // Unix 毫秒
    data: SessionEventMap[K];
    ignorable?: true;   // 缺省 = 必需事件；不认识的必需事件必须拒建会话
  } & (K extends SurfaceEventType ? {
    sourceEventSeqs?: number[];
    surfaceOp?: SurfaceOp;
  } : object);
}[T];
```

- SurfaceEventType = `'user/message' | 'assistant/message' | 'tool/result'`（唯一可上模型可见面的三类）
- SurfaceOp = `'append' | { op: 'replace'; start: number; end: number }`（compaction 用 replace 删除被遮蔽节点）
- 派生历史 = 按 surfaceOp 顺序走 surface 节点投影（`Session.deriveMessages()`）

人类 transcript 必须注意首步事件顺序：`turn/start → step/start → user/message* → assistant/chunk* → assistant/message`。
因此不能在 `step/start` 时把空助手组件插入视图；应在首个 assistant payload 到达时再挂载，否则助手输出会排到本轮用户输入之前。

### 1.4 Session（活会话）

```ts
class Session {
  readonly header: SessionHeader;      // 创建元数据（version/cwd/lineage/seedLength/createdAt）
  get id(): SessionId;
  readonly firstLiveSeq: number;       // 本进程首个 seq（种子长度）
  get events(): readonly SessionEvent[];  // 深冻结不可变快照
  get seq(): number;
  get surface(): SessionSurface;
  append<T>(type: T, data: SessionEventMap[T], ...opts: T extends SurfaceEventType ? [SurfaceIntent] : []): SessionEvent<T>;
  requestHeader(): EpochHeader | undefined;
  requestContext(): RequestContext | undefined;
  deriveMessages(): Message[];         // 缓存增量投影；返回新数组、共享深冻结 Message
  deriveEventMessage(event: SessionEvent): Message | null;
  static create(id, seed?, header?): Session;
  static fromRestore(id, seed, header): Session;
}
```

### 1.5 SessionStore（`ctx.sessions`）

```ts
class SessionStore extends Service {
  create(id?: SessionId, options?: CreateSessionOptions): Session;   // 便捷：创建+入店+宣布
  prepare(id?, options?: PrepareSessionOptions): Session;            // 不入店；配合 enter/announce
  enter(session: Session): () => void;                               // 装发布钩子+入店，返回 detach
  announce(session: Session): void;                                  // 发 session/created
  flush(session: Session): Promise<boolean>;                         // 持久化屏障：唯一入口
  get(id: SessionId): Session | undefined;
  list(): Session[];
  fork(source: Session | SessionId, boundary?: number, childSessionId?: SessionId): Session;
}
```

### 1.6 cordis 事件（dsh-session 声明合并）

| 事件 | 签名 | 语义 |
|---|---|---|
| `session/created` | `(session: Session) => void` | 同步抛错可否决发布（回滚） |
| `session/disposed` | `(session: Session) => void` | 离店通知 |
| `session/event` | `(session: Session, event: SessionEvent) => void` | **追加后 fire-and-forget 馈送（TUI 渲染主通道）**；种子重放不发出 |
| `session/flush` | `(session: Session) => Promise<void> \| void` | 并行耐久检查点 |

### 1.7 TodoItem（`@deepseek-ai/dsh-tool-todo`）

```ts
export interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
}
```

---

## 2. Agent — `@deepseek-ai/dsh-agent`

### 2.1 Agent（活代理句柄）

```ts
export interface Agent {
  readonly id: SessionId;
  readonly options: AgentOptions;          // { provider?, model?, maxTokens? }
  readonly session: Session;               // 同一 id 的活会话
  readonly inbox: Inbox;
  readonly status: AgentStatus;            // 'idle' | 'running'
  readonly ctx: Context;                   // agent 作用域上下文
  cancel(cause: AgentCancelCause, options?: CancelOptions): void;   // cause: {kind:'user'|'parent'|'hook'|'disposed'}
  whenIdle(): Promise<void>;
  runMaintenance<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T>;
  send(message: UserMessage, target: InboxTarget, wakeup: boolean): void;
  followup(message: UserMessage): void;    // 排队普通后续轮并唤醒
  steer(message: UserMessage): void;       // 提交最近 step 的 steering
  inject(message: UserMessage): void;      // 排队模型可见上下文，不唤醒
}
export type InboxTarget = 'next-turn' | 'next-step';
export interface Inbox {
  readonly nextTurn: readonly UserMessage[];
  readonly nextStep: readonly UserMessage[];
  readonly hasPending: boolean;
  clear(): void;
  replace(messageId: MessageId, message: UserMessage): boolean;
  remove(messageId: MessageId): boolean;
  splice(target: InboxTarget, start: number, deleteCount: number, inserted: UserMessage[]): UserMessage[];
}
```

### 2.2 AgentRegistry（`ctx.agents`）

```ts
class AgentRegistry extends Service {
  create(options: CreateAgentOptions): Promise<AgentHandle>;   // 新建 agent+session（factory 路径）
  resume(options: ResumeAgentOptions): Promise<AgentHandle>;   // 从持久化会话恢复（factory 路径）
  register(agent: Agent): () => void;
  get(id: SessionId): Agent | undefined;
  list(): Agent[];
  roots(): Agent[];
  isOwnedBy(id: SessionId, owner: Agent): boolean;
  currentInitiator(): Agent | undefined;
  requireInitiator(): Agent;
  withInitiator<T>(agent: Agent, operation: () => T): T;
}
export interface AgentHandle { agent: Agent; dispose(): Promise<void>; }
```

- `CreateAgentOptions`: `{ sessionId, meta?: { cwd?, parentSession?, seedLength?, origin?, delegationDepth?, agentPreset? }, seed?, agentOptions?, signal?, setup? }`
- `ResumeAgentOptions`: `{ resumeSessionId, agentOptions?, signal?, setup? }`（内部先 `ctx.sessionPersistence.prepare`）

### 2.3 模型选择

```ts
export interface ModelSelection { provider: string; model: string; reasoningEffort?: ReasoningEffortId; }
export interface ModelSelectionRef { current: ModelSelection | undefined; assembled: ModelSelection | undefined; }
export declare function installModelSelection(agentCtx: Context, selection: ModelSelectionRef): () => void;
```

### 2.4 cordis 事件（dsh-agent）

| 事件 | 载荷 | TUI 用途 |
|---|---|---|
| `agent/created` / `agent/disposed` | `{ agent }` | 生命周期 |
| `agent/status` | `{ agent, status }` | **编辑框/指示器状态切换（idle/running）** |
| `agent/inbox/inserted` / `claimed` / `discarded` | `{ agent, message, turn? }` | 队列显示 |
| `agent/session-start` | `{ agent, source: 'startup'\|'resume'\|'clear'\|'compact' }` | 首轮前通知 |

---

## 3. 命令行 — `@deepseek-ai/dsh-cmdline`

```ts
export interface CmdlineArgs { get(): readonly string[]; }   // 启动器 flag 之后的所有参数原样
export interface AppExit { (code: number): void; }
declare module '@deepseek-ai/cordis' {
  interface Context { cmdlineArgs?: CmdlineArgs; appExit?: AppExit; }
}
export declare function parseCmdline(ctx: Context, program: Command): void;  // commander 程序；help/version/语法错=进程终止
```

- TUI 自持 `--resume <id>` / `--session <id>` / `--help`：注入 `cmdlineArgs`，用自己的 commander program 解析，在 action 中发布 `tuiStartup` 服务；普通行 `inject: [tuiStartup]` 惰性读配置。

---

## 4. 交互

### 4.1 提问 — `@deepseek-ai/dsh-user-questions`

```ts
export interface AskUserQuestionItem {
  id: string; question: string; detail?: string; header?: string;
  options?: AskUserQuestionOption[];      // { label, description? }
  multiSelect?: boolean;
  intent?: AskUserQuestionIntent;         // { kind: 'plan-review', approve: string }
}
export interface AskUserQuestionAnswerItem { id: string; selected: string[]; custom?: string; }
export interface AskUserQuestionAnswer { answers: AskUserQuestionAnswerItem[]; }
export interface AskUserQuestionRequest { questions: AskUserQuestionItem[]; agent?: Agent; signal?: AbortSignal; }
class UserQuestionService extends Service {   // ctx.userQuestions
  ask(request: AskUserQuestionRequest): Promise<AskUserQuestionAnswer>;
  // 错误码：CALLER_NOT_LIVE / DELEGATED_CALLER
}

// UI answerer 监听 agent-scope waterfall：
// 'user-questions/request'(request, next): Promise<AskUserQuestionAnswer>
```

- 模型侧工具在 `@deepseek-ai/dsh-tool-ask-user`；TUI 监听 `user-questions/request` waterfall，渲染对话框并返回答案。

### 4.2 授权 — `@deepseek-ai/dsh-user-approval`

```ts
export type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable';
export type ApprovalPolicy = 'ask' | 'never';

export interface ApprovalRequest {
  readonly agent: Agent;
  readonly toolName: string;
  readonly callId?: ToolCallId;
  readonly reason?: string;
  readonly signal?: AbortSignal;
}

declare module '@deepseek-ai/cordis' {
  interface Context { approval: ApprovalService; }
  interface Events {
    // waterfall：回答者返回 outcome 认领请求；不认领时调用 next()。
    // agent-scoped listener 只收到对应 agent 的请求。
    'approval/request'(
      this: Scoped<ApprovalService>,
      req: ApprovalRequest,
      next: () => Promise<ApprovalOutcome>,
    ): Promise<ApprovalOutcome>;
  }
}

class ApprovalService extends Service {
  request(req: ApprovalRequest): Promise<ApprovalOutcome>;
  setPolicy(agent: Agent, policy: ApprovalPolicy): void;
  overrideOf(session: Session): ApprovalPolicy | undefined;
}
```

- 默认策略 `ask` 把请求交给 answerer waterfall；没有回答者或回答者抛错时返回 `unavailable`，调用方必须 fail closed。`never` 不显示弹框并固定返回 `rejected`。
- 只有 `allowed-once` 授权当前单次操作；Esc/关闭 UI 必须返回 `rejected`，`AbortSignal` 触发时返回 `cancelled`。
- 审计事件为 `approval/asked` 与 `approval/decided`（同一 request id，log-only）；策略覆盖记录为 `approval/policy`。`request()` 只能在 open turn 内调用，以保证审计事件对完整落在回合边界内。
- TUI 在 `approval/request` 上注册 waterfall answerer，只认领当前前台 agent 的请求，展示 toolName/reason，并允许“仅本次授权”或“拒绝”；其他 agent 调用 `next()`。

### 4.3 hooks 桥 — `@deepseek-ai/dsh-hooks-claude-code` + `@deepseek-ai/dsh-hook-protocol`

bundle 插入两行桥（插件非 Service，可多实例）：`hooks-claude-code`（项目级
`./.claude/hooks.json`，`OMDSH_HOOKS_CONFIG` 可覆盖）与 `hooks-claude-code-user`
（用户级 `dshHomePath('hooks.json')` = `~/.dsh/hooks.json`）。每行 configPath
进程级、加载时读一次；两层 hook 同跑各拦截缝（`tools/pre-execute`、
`tools/post-execute`、`agent/pre-step`、`agent/turn-stopping`、
`agent/session-start`、`subagent/*`），waterfall 上任一层 deny 即阻断。
`ask` 决策落到 `ctx.approval` → TUI 现有 `approval/request` answerer。

TUI 消费的 log-only session 事件（`dsh-hook-protocol/lib/types/types.d.ts:8-39`
声明合并，必须 `import type {} from '@deepseek-ai/dsh-hook-protocol'`）：

```ts
'hook/invoked': { turn: number; point: string; dialect: 'claude-code' | 'codex'; matcher?: string; handlerId: string }
'hook/result':  { turn: number; point: string; handlerId: string; decision: string; exitCode?: number; stderrSummary?: string; durationMs: number }
```

- invoked/result 按 `handlerId` 配对且在日志中相邻（串行执行保证）；TUI 用
  Map 暂存 invoked 取 matcher，在 result 处渲染 Hook 卡片。
- `decision` 取值：解析出的 `allow|deny|ask|approve|block`、`continue:false` 记为
  `stop`、无显式决策记为 `pass`。TUI 对 `deny|block|stop` 弹警告通知。
- 限制：`updatedInput` 不生效；`allow` 不预授权；Stop 无连续阻断上限；仅
  command hook 运行。详见 `docs/hooks.md` 与桥的 README。

---

## 5. LLM 词汇 — `@deepseek-ai/dsh-llm`

### 5.1 内容块（ContentBlock，合并可扩展）

```ts
export interface TextBlock { type: 'text'; text: string; }
export interface ReasoningBlock { type: 'reasoning'; text: string; }
export interface ImageBlock { type: 'image'; attachment: ImageAttachmentRef; }
export interface ToolCallBlock { type: 'tool-call'; id: ToolCallId; name: string; arguments: string; }
export interface ToolResultBlock { type: 'tool-result'; toolCallId: ToolCallId; content: ContentBlock[]; isError?: boolean; }
export type ContentBlock = ContentBlockMap[ContentBlockType];   // 按 type 判别
```

### 5.2 消息

```ts
export interface Message {
  readonly id: MessageId;
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: ContentBlock[];
  readonly source: MessageSource;    // user {kind:'user'} | plugin {kind:'plugin',plugin,...form} | model | tool
}
export interface UserMessage extends Message { readonly role: 'user'; }
export interface AssistantMessage extends Message { readonly role: 'assistant'; readonly source: ModelMessageSource; }
export interface ToolResultMessage extends Message { readonly role: 'user'; readonly content: [ToolResultBlock]; readonly source: ToolMessageSource; }
export declare function createUserMessage<T extends NewUserMessage>(input: T & {...}): T & Pick<UserMessage, 'id'|'role'>;
```

### 5.3 流块（StreamChunk）

```ts
export type StreamChunk =
  | { type: 'block-start'; index: number; blockType: ContentBlockType }
  | { type: 'text-delta'; index: number; text: string }
  | { type: 'reasoning-delta'; index: number; text: string }
  | { type: 'tool-call-delta'; index: number; id: ToolCallId; name?: string; argumentsDelta: string }
  | { type: 'block-end'; index: number; block: ContentBlock }
  | { type: 'usage'; usage: TokenUsage }
  | { type: 'finish'; reason: FinishReason; replayState?: ReplayEnvelope };
```

`ReplayEnvelope = { response: unknown; blocks?: readonly unknown[] }`：适配器私有重放状态，按块位置与 `BlockAssembler.blocks()` 同步裁剪；长度不匹配则整体丢弃。

### 5.4 用量与失败

```ts
export interface TokenUsage {
  inputTokens: number; outputTokens: number;
  cacheReadTokens?: number; cacheWriteTokens?: number; reasoningTokens?: number;  // 计数不相交
}
export interface LlmFailure { message: string; code: string; status?: number; providerRetryAfterMs?: number; requestId?: string; }
```

### 5.5 图片附件 — `@deepseek-ai/dsh-attachment`

```ts
export type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
export interface SaveImageAttachment { data: Uint8Array; mediaType: ImageMediaType; name?: string; }
export interface EncodedImageAttachment { mediaType: ImageMediaType; data: string; name?: string; }
export interface ImageAttachmentRef {
  attachmentId: AttachmentId; mediaType: ImageMediaType; bytes: number; width: number; height: number; name?: string;
  originalDimensions?: { width: number; height: number };
}
export interface ImageAttachmentLimits {
  maxImageBytes: number; maxImagesPerMessage: number; maxMessageImageBytes: number;
  maxImagePixels: number; maxImageDimension: number; mediaTypes: readonly ImageMediaType[];
}
class AttachmentStore extends Service { // ctx.attachments
  readonly imageLimits: ImageAttachmentLimits;
  validateImage(input: SaveImageAttachment): Promise<void>;       // 草稿准入校验，不持久化
  saveImages(inputs: readonly SaveImageAttachment[]): Promise<readonly ImageAttachmentRef[]>; // 全批校验后有序提交
  saveImage(input: SaveImageAttachment): Promise<ImageAttachmentRef>;
  readImage(ref: ImageAttachmentRef, signal?): Promise<StoredImageAttachment>;
}
```

- 会话事件只保存 `ImageAttachmentRef`，不得保存 base64、本地路径、浏览器 URL 或 provider URL。
- 未提交的 composer 图片由前端临时持有，并按 `maxImagesPerMessage` / `maxMessageImageBytes` 限制草稿内存；切换前台会话时丢弃图片字节与对应标记；发布 `user/message` 前必须先 `saveImages`，再构造 `{ type: 'image', attachment: ref }`。
- `saveImages` 统一执行单图、批次数量和总字节限制；失败不返回部分引用。

---

## 6. 会话持久化/投影/查询 —（scout 章节，待补）

## 7. skill/commands/token-meter/goal/compaction/system-prompt/title/reference —（scout 章节，待补）

## 8. agent-loop/tools/terminal 配置 schema —（scout 章节，待补）

## 9. dsh-base 默认行清单（bundle 层参考）

`$PKG/dsh-base/cordis.patch.yml`（一行 insert）已挂载：timer、hmr、llm、session、typert 三件套、
session-title(+llm)、user-questions、agent、agent-default-model、jobs、llm-retry、settings、
credentials、llm-pi-ai、session-persistence-jsonl（root=`dshHomePath('sessions')`）、attachment-local、
session-query-sqlite（path `:memory:`、openAt `never`）、session-projection、session-telemetry-otel、
storage、storage-json（root=`dshHomePath('storages')`）、storage-domain（backend `json`）、
session-projection-cache（writeEveryEvents `200`、writeIntervalMs `5000`）、
subprocess、sandbox、sandbox-policy（mode `workspace-write`，workspaceRoot=process.cwd()）、
bash-sandbox（win32 禁用）、pwsh-sandbox（仅 win32）、approval、permission、shell-env、
tool-bash（win32 禁用）、tool-pwsh（仅 win32）、tool-pwsh-persistent（仅 win32）、tool-jobs、fs-observation-policy、tool-fs、
tool-fs-search、agent-instructions、skill、skill-filesystem、skill-badge（disabled）、tool-skill、
commands、command-feedback、goal、goal-round-driver、command-goal、plan-mode、token-meter、
compaction-basic、command-compact、subagent 三件套、tool-subagent-control(+list-agents)、
tool-subagent、tool-subagent-fork、tool-subagent-report、workflow、tool-workflow、timeout-policy、
spill-local、spill-policy（maxInlineBytes 50000）、session-checkpoint-policy、tool-result-pruner、
tool-todo、tool-goal、tool-ralph、tool-str-replace-editor、repeat-tool-reminder、web_search 系列。

→ TUI bundle 的 patch 只需**覆盖** `agent-loop`/`system-prompt`/`llm-deepseek`/`fs-sandbox`/`tools`
行 + **插入** session-reference/tmux-context/tui 行。storage 三件套与 session-projection-cache
由 0.1.2-alpha.2 的官方 base 提供，TUI 不得重复插入。

可选的独立 `dsh-web-access` bundle 安装在 `tui` Profile 后层：禁用 base 的
`web-search-deepseek` 与 `tool-web`，保留 `web` seam 并把 search/fetch provider 固定为
`web-access`，由插件独占 `web_search` 并额外注册 `fetch_content`、`source_check`、
`get_search_content`。该能力不进入 TUI 源码或 `cordis.patch.yml`；通过 Profile bundle 组合。

---

## 6. 会话持久化/投影/查询（0.1.2-alpha.2 合约）

### 6.1 SessionPersistence（`ctx.sessionPersistence`，抽象服务）

```ts
abstract class SessionPersistence extends Service {
  abstract locate(meta: SessionHeader): SessionLocation | undefined;
  abstract readonly supportsRawArtifacts: boolean;
  readRaw(_id, signal?): Promise<SessionRawArtifact | undefined>;
  abstract create(meta: SessionHeader): Promise<void>;
  abstract append(id, events): Promise<void>;
  prepare(id, signal?): Promise<SessionPreparation>;   // resume 专用排他预留
  abstract load(id): Promise<SessionInspection>;        // 冷恢复：合成 tool/result+step/end+turn/end{interrupted}
  abstract inspect(id, signal?): Promise<SessionInspection>;
  abstract readFrom(id, fromSeq, signal?): Promise<{ meta; events }>;  // watermark 原语
  abstract list(signal?): Promise<SessionHeader[]>;
  abstract listSnapshots(signal?): Promise<SessionPersistenceSnapshot[]>;
}
```

### 6.2 SessionProjectionRegistry（`ctx.sessionProjections`）

```ts
interface SessionProjectionMap {}   // merge-extensible：goal/title/tokenUsage/contextPressure/contextBreakdown 等键
interface ProjectionDefinition<K, S> { key; schema; init(); apply(state, event): S; view(state): V; stateVersion: number; }
class SessionProjectionRegistry extends Service {
  register(definition): () => void;
  onChanged(listener: (session, key, value, seq) => void): () => void;
  snapshot(session): ProjectionSnapshot;          // { asOfSeq, values: Partial<SessionProjectionMap> }
  checkpoint(session): ProjectionCheckpoint;
  restoreFloor(checkpoint): number | undefined;
  viewCheckpoint(checkpoint): Partial<SessionProjectionMap>;
  restore(checkpoint, events, baseSeq): { snapshot; checkpoint };
}
```

### 6.3 SessionProjectionCache（`ctx.sessionProjectionCache`）

```ts
class SessionProjectionCache extends Service {
  cachedSnapshot(meta: SessionHeader): ProjectionSnapshot | undefined;  // 零 I/O 列表读
  write(session): Promise<void>;          // 先 ctx.sessions.flush 再整记录替换
  coldSnapshot(id, signal?): Promise<ProjectionSnapshot>;
}
// Config（必填）：writeEveryEvents / writeIntervalMs（组合示例 200 / 5000）
// 必写点：turn/end、会话 detach。行绑定日志生命周期（createdAt+cwd 见证），ver 不匹配即弃。
```

### 6.4 SessionQueryEngine（`ctx.sessionQuery`，抽象服务）

```ts
abstract class SessionQueryEngine extends Service {
  abstract searchSessions(request, exec?): Promise<SessionSearchPage<SessionSearchHit>>;
  abstract searchEvents(request, exec?): Promise<SessionEventSearchPage>;
  listSessions(signal?): Promise<SessionRecord[]>;                 // 轻量；live 优先
  readSession(sessionId): Promise<SessionLogSnapshot>;
  filterSessions(filters, signal?): Promise<SessionRecord[]>;
  readTitle(sessionId, signal?): Promise<SessionTitleSnapshot | undefined>;
  readTitleSnapshots(sessionIds, signal?): Promise<SessionTitleObservationResult[]>;
  listEvents(sessionId): Promise<SessionEventRecord[]>;
  readSurface(sessionId): Promise<SessionSurfaceSnapshot>;
  traceSession(sessionId, signal?): Promise<SessionLineageTrace>;
  traceEvent(request, signal?): Promise<SessionEventTraceObservation>;
  readEvent(request, signal?): Promise<SessionEventWindow>;        // before/after ≤ readWindowMax=50
}
```

- 过滤器：`{kind:'id'|'cwd'|'created-at'|'parent'|'availability'}` / 事件 `{kind:'seq'|'time'|'type'|'surface'|'text'}`；AND 语义、同子句 OR。
- TUI 消费：`/resume` 列表用 `listSessions()`，保留当前项目中已持久化、`header.origin !== 'subagent'` 且不是当前活动会话的顶层会话，再用
  `readTitleSnapshots` 读取标题；显式参数优先按 session id 匹配，再按规范化后的唯一标题匹配，重名时要求改用 id。预览用 `readSurface`。错误码闭集 18 个 `SESSION_QUERY_*`。
- TUI 的 `/rename` 直接调用 `ctx.sessionTitle.rename(liveSession, title)`，标题仍以 `session/title` 事件为唯一真相源。`/fork` 通过
  `ctx.agents.create` 的原生 `seed + inheritedEventCount + meta.parentSession/isSeeded` 创建 Agent 所有的分支生命周期；不能先调用会立即发布裸会话的
  `ctx.sessions.fork` 再为同一 id 创建 Agent，否则会违反 Agent 工厂的单一会话所有权与 id 碰撞边界。

---

## 7. 状态与能力面（scout 汇总）

### 7.1 dsh-commands（`ctx.commands`）

```ts
class CommandRuntime extends Service {
  register(definition: CommandDefinition): () => void;   // { name, description, input?, recordInput?, handler }
  list(agent: Agent): readonly CommandDescriptor[];
  find(agent: Agent, name): CommandDefinition | undefined;
  execute(agent, line, images: readonly EncodedImageAttachment[], signal): Promise<CommandExecution | undefined>; // 语法/未知名 → undefined 不记日志
}
parseCommand(line: string): ParsedCommand | undefined;
// CommandInputDescriptor.images?: boolean；未声明图片输入的命令必须拒绝附件。
// CommandInvocation.attachments 为执行器已持久化的 readonly ImageBlock[]，由 handler 决定如何使用。
// SessionEvent：'command/run' { commandId, name, args?, source } / 'command/done' { commandId, kind, text?, sourceEventSeq? }
// CommandResult: { kind:'success', text?, sourceEventSeq? } | { kind:'error', text }
```

### 7.2 dsh-goal（`ctx.goals`）

```ts
// SessionEvent：'goal/change' = 全量快照变更（kind:'goal/change', version:1, operation: create|edit|pause|resume|complete|block|clear, goal: GoalSnapshot, …）或 clear tombstone
foldGoal(events): FoldedGoal;          // 严格重放；TUI 用 applyGoalProjection（投影宽松版）
interface TodoItem { content: string; status: 'pending' | 'in_progress' | 'completed'; }  // 真身在 dsh-tool-todo
interface GoalSnapshot extends GoalRef { objective; phase: 'active'|'paused'|'blocked'|'complete'; blockedReason?; maxGoalRounds }
```

### 7.3 dsh-compaction（`ctx.compaction`，抽象）

```ts
// SessionEvent：'compaction/start'|'summary'|'end'|'prune'（log-only 锁括号 + 阴影价协议）
// 成功序列：start → summary（shadowedRange/shadowedSeqs/shadowedTokenCount）→ user/message(surfaceOp replace, source=compactCheckpointSource) → end
// TUI：start 起显示 "Context being compacted" 状态；end 或 error 清除；replace 事件由事件驱动的 transcript 天然处理
```

### 7.4 dsh-token-meter（`ctx.tokenMeter`）

```ts
measure(session, requestHeader?): TokenMeasurement;  // { totalTokens, surfaceTokens, … }
// 投影键：tokenUsage（四桶 disjoint: uncachedInput/output/cacheRead/cacheWrite）、contextPressure、contextBreakdown
// 占用率 UI：projectedTokens / 独立解析的 capacity（requestContext().contextWindow 或 LlmResolvedModelInfo.context）
```

### 7.5 dsh-system-prompt（`ctx.systemPrompt`）

```ts
// Config: { includeHarnessIdentity?, includeRuntimeContext?, persona?, toolOrder? }
// persona → order-0 'deployment:persona' section；agent-scoped 同名 section 遮蔽全局
renderPrompt(assembly: PromptAssembly): string;   // 严格 {{variable}} 插值
```

### 7.6 dsh-session-title（`ctx.sessionTitle`）

```ts
// SessionEvent：'session/title'（last-wins，log-only）；投影键 title: string | null
foldSessionTitle(events): SessionTitleSnapshot | undefined;
// 服务：get(session) / rename(session, title)（pin 住）/ refresh(session, signal?) / register(provider)
```

### 7.7 dsh-session-reference（`ctx.sessionReferenceResolver`）

```ts
parseSessionReferenceText(text): { text; references: SessionReferenceInput[] };   // @[label](dsh-session:<b64>)
listCandidates(agent, query?, limit?, signal?): Promise<SessionReferenceCandidate[]>;
prepare(agent, content, references, signal?): Promise<PreparedReferencedMessage>;  // 快照+上下文，错误码 SESSION_REFERENCE_*
// 限制：MAX_REFERENCES=3、DEFAULT_CANDIDATE_LIMIT=50、DEFAULT_MAX_REFERENCE_BYTES=65536
```

### 7.8 dsh-skill（`ctx.skills`）

```ts
class SkillRegistry extends Service {
  list(options?): Promise<SkillSummary[]>;        // { name, description, whenToUse?, invocation, source, provider }
  snapshot(options?): Promise<SkillCatalogSnapshot>;  // { skills, complete }
  get(name, options?): Promise<SkillDefinition | undefined>;
}
scopeOf(agent.ctx): ScopeKey | undefined; // TUI 查询必须传 scope，才能看到 agent preset 层的 skills
isUserInvocable(skill): boolean;   // TUI `/skill:` 列表过滤
```

### 7.9 dsh-jobs（`ctx.jobs`）

```ts
type JobStatus = 'running' | 'stopping' | 'completed' | 'killed' | 'failed';
interface JobSnapshot {
  id: JobId; kind: JobKind; label: string; outputLimitBytes?: number;
  ownerSession?: SessionId; status: JobStatus; detail?: string;
  startedAt: number; finishedAt?: number; reported: boolean;
}
abstract class JobRegistry extends Service {
  start(spec: JobStart): JobId;
  list(caller?: Agent): JobSnapshot[];
  get(id: JobId, caller?: Agent): JobSnapshot;
  read(id: JobId, caller?: Agent): JobRead;
  kill(id: JobId, caller?: Agent, reason?: string): 'requested' | 'already-finished';
  wait(id: JobId, timeoutMs: number, caller?: Agent, signal?: AbortSignal): Promise<JobSnapshot>;
  onJobDone(listener: JobDoneListener): () => void;
  onJobsChanged(listener: JobsChangedListener): () => void;
  attachController(name: string): () => void;
}
```

- `list/get/read/kill/wait` 以 caller 的 session id 做 owner 访问隔离；任务 id 可预测，不能把 id 当授权边界。
- `list(agent)` 返回该 agent 拥有的任务及无 owner 的任务快照；每次返回新对象，不是 live registry state。
- `onJobsChanged(owner)` 是 owner 粒度的全量重读通知；`owner === undefined` 表示无 owner 任务发生变化，对所有 caller 可见。
- 活跃状态为 `running | stopping`；终态为 `completed | killed | failed`。
- dsh base 已挂载 `dsh-jobs-local` 和模型侧 `dsh-tool-jobs`；TUI 只消费 registry，不复制任务生命周期。

### 7.10 dsh-shell（`ctx.shell`）

```ts
interface ShellExecRequest {
  command: string; workdir?: string; timeoutMs?: number; stdoutMaxBytes?: number;
  signal?: AbortSignal; stdin?: string; env?: Record<string, string>;
  sandboxPolicy?: SandboxExecutionPolicy;
}
interface ShellRunResult {
  exitCode: number | null; signal: NodeJS.Signals | null; timedOut: boolean; aborted: boolean; timeoutMs: number;
  stdout: CollectedOutput; stderr: CollectedOutput; sandbox?: ShellSandboxInfo;
}
abstract class ShellExecutor extends Service {
  abstract resolve(request: ShellExecRequest): ShellExecSpec;
  abstract run(spec: ShellExecSpec): Promise<ShellRunResult>;
}
```

Profile 在 Windows 组合 pwsh executor，在 POSIX 组合 bash executor；TUI 的用户主动 `!` 命令必须复用 `ctx.shell.resolve/run`，从而继承 cwd、环境清理、输出上限、超时和 sandbox，不能直接 `child_process.spawn` 复制或绕过 harness。命令完成后编码成 `source.kind = 'user'` 的 `UserMessage` 并通过 `agent.followup()` 开启独立回合；持久 `user/message` 同时是恢复后重建 shell 结果卡的真相源。

---

## 8. 配置行 schema（cordis.patch.yml 编写依据）

### 8.1 agent-loop 行

```ts
interface Config {
  maxParallelToolCalls?: number;   // default 10，min 1；1=串行
  agents: (AgentOptions & {
    id: string;                    // required，稳定 label
    sessionId?: SessionId;         // 稳定身份；与 resumeSessionId 互斥
    cwd?: string;                  // 仅新建会话
    resumeSessionId?: SessionId;   // 加载既有持久化会话
  })[];
}
// AgentOptions: { provider?, model?, maxTokens? }
// 无 sessionId/resumeSessionId → ${id}-session-<uuid> 每次重启新会话；配置 agent 自动启动
```

### 8.2 其他行

- `agent-default-model`：`{ provider: string (req), model: string (req) }`；settings 分节另有 `reasoningEffort?`
- `agent-instructions`：`maxBytes` 必填；其余可选（projectRootMarkers 默认 ['.git']、candidates [AGENTS.md, CLAUDE.md]…）
- `tools`：`{ mode?: 'native'|'ptc'|'both' (default native), maxParallelSubCalls?: number (default 10) }`
- `system-prompt`：`{ persona?, toolOrder?, includeHarnessIdentity?, includeRuntimeContext? }`
- `fs-sandbox`：`{ cwd }`（workspace 根）
- `approval`：`{ policy?: 'ask'|'never' }`（默认 `ask`；交互前端需注册 `approval/request` answerer）
- `llm-deepseek`：`{ apiKeyEnv?, baseURL?, thinking?, reasoningEffort?, maxRequestImageBytes? }`；`reasoningEffort` 支持 `off | low | high | max`；`models[]` 可声明 `inputModalities: ['text'] | ['text','image']`（settings 分节 llm-deepseek 可热覆盖）
- `dsh-terminal`：无配置；**TUI 不直调**（owner 绑定，供 dsh-tool-terminal 消费）

---

## 9. TUI 接线备忘（从合约到实现）

1. **启动**：`tui-startup` 行 inject `cmdlineArgs`，commander 解析 `--resume`/`--session`/`--help` → 提供 `tuiStartup`（sessionId / resumeSessionId）；agent-loop 行 `inject: [tuiStartup]` 惰性读。
2. **取 agent**：`ctx.agents.get(sessionId)` → `Agent`；`agent.session.events` 为不可变日志快照。
3. **渲染主通道**：`session/event` 事件（追加后馈送）+ 初始 `agent.session.events` 重放（种子不发出）；`tool/code-dispatch-start` / `tool/code-dispatch` 按 parent/sub-call id 组成递归工具卡，与 Web 的 `subCalls` contract 一致。
4. **状态**：`agent/status` 事件 → 编辑框边框/指示器；`agent.session.header.cwd` 为 workspace。
5. **提交输入**：编辑框消息统一调用 `agent.steer(createUserMessage({ content, source: { kind: 'user' } }))`；剪贴板图片在草稿中只保留内存字节与 `[Image #N]` 标记，提交时先由 `ctx.attachments.saveImages` 持久化仍保留标记的图片，再把 durable image block 加入 `content`。idle 时立即在 transcript 乐观渲染普通用户消息并按 message id 等待正式事件确认，不显示 steer 待处理投影；running 时由最近的下一 step 领取，并将 `agent/inbox/inserted` 投影到 Steering 面板。正式 `user/message` 到达后，idle 乐观消息只确认去重，running 预览则按 message id 移除并进入 transcript；`discarded` 或未接纳 turn 结束时同步清理。Alt+Up 合并 `inbox.nextStep`/`nextTurn` 中可编辑的直接用户文本到当前草稿，并通过 `inbox.remove(message.id)` 逐条撤回原队列项。 运行中输入框非空时 Ctrl+C 只清空草稿；空输入框 Ctrl+C 或任意草稿状态的 Esc 在调用 `agent.cancel` 前，先将全部可编辑 Steering 消息按队列顺序合并回输入框并从 inbox 移除，避免取消时丢失或重复投递。
6. **中断**：`agent.cancel({ kind: 'user' })`。
7. **提问**：监听 agent-scope `user-questions/request` waterfall；对话框完成后返回 `AskUserQuestionAnswer`，不认领的请求调用 `next()`。
8. **授权**：监听 waterfall `approval/request`；只认领当前前台 agent，弹框返回 `allowed-once`/`rejected`，中止返回 `cancelled`，其他 agent 调用 `next()`。
9. **命令**：`ctx.commands.execute(agent, line, images, signal)`；普通命令传 `[]`，带图片标记的草稿仅在命令声明 `input.images` 时传入 base64 wire batch，否则前端拒绝提交并保留草稿。`/help` 列表用 `ctx.commands.list(agent)`。
10. **模型选择**：`installModelSelection(agent.ctx, selectionRef)` + `agentDefaultModel.currentSelection()/saveSelection()`。
11. **投影消费**：`ctx.sessionProjections.snapshot(session)` 或 `sessionProjectionCache.cachedSnapshot(header)`（列表零 I/O）。
12. **Profile 与 TUI 代码重载（暂时关闭）**：当前 bundle 将 `tui-reload` Profile 行标记为 disabled，TUI 不注入 `tuiReload`，也不提供 `/reload` 命令、帮助项或补全项。`src/reload.ts`、包导出与专项测试仅作为未启用的调查 WIP 保留，不能视为运行时能力；恢复前必须先解决 `docs/RELOAD_ISSUE.md` 记录的 generation 与私有 HMR 边界，并重新完成 Loader 与 ConPTY 验收。
13. **后台任务导航**：主界面的子 Agent 列表来自 `ctx.agents.list()`，按 `session.header.parentSession === foreground.id` 且 `origin === 'subagent'` 过滤；展示身份只读取每个子会话 `seedLength` 之后的自有 `subagent/descriptor`，避免把 fork seed 中祖先 descriptor 误认成当前子 Agent。面板同时通过 `ctx.jobs.list(foreground)` 展示该 Agent 的 running/stopping Jobs，并由 `ctx.jobs.onJobsChanged` 刷新；Jobs 不再重复占用 footer。空编辑器中按下方向键展开 Background tasks 列表，按左方向键返回主 Agent 视图，不改变 foreground Agent，也不向子 Agent 或 Job 投递输入。
14. **本地 shell 输入**：行首 `!` 由 TUI 截获，正文交给当前平台已组合的 `ctx.shell` executor；完成前显示 pending shell 卡，完成后把 shell、命令、stdout、stderr、退出码、超时/中止/sandbox 摘要编码为可逆文本，创建 `source.kind = 'user'` 的消息并 `agent.followup()`，从而既持久渲染在 transcript，也作为下一独立回合的用户输入进入模型上下文。
