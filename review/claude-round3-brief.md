# 第三轮审查：数据层隐性 bug 与效率问题（交给 Codex 修复）

审查日期：2026-11-10。对象：`fix/data-layer-robustness` 工作区（HEAD `88b7396` + 未提交的 C1—C8 修复）。
本轮只做了静态阅读，**没有运行测试，也没有写复现用例**；下面每条都给出了触发顺序，修复前请先写一个会失败的复现测试来确认。

行号对应当前工作区文件。按建议的修复优先级排序。

---

## P1 — 会改坏数据或打断用户操作

### T1 编辑计时记录会把所有时间段截断到整分钟

- 位置：`src/components/SessionEditor.tsx:11-15`（`toInput` / `fromInput`）、`:69`、`:75`、`:90`
- 原因：编辑器用 `datetime-local`（分钟精度）回填时间段，保存时把**所有**行重新从输入框字符串解析回毫秒，不区分用户有没有改过这一行。
- 触发：计时器记录了 `09:00:42–09:25:17`。打开编辑器，只把科目从"数据结构"改成"操作系统"，保存。
- 实际：时间段被改写为 `09:00:00–09:25:00`，时长从 24:35 变成 25:00。每一段都会漂移最多 ±59 秒。
- 更糟的情况：同一分钟内开始和结束的段（例如 `09:00:10–09:00:50`，`MIN_SESSION_MS` 只有 1 秒，这种记录是合法的）回填后开始 = 结束，校验报"结束时间必须晚于开始时间"，**这条记录无法只改科目**。
- 建议：每行记住原始的毫秒值；保存时如果该行的输入字符串等于 `toInput(原始值)`，就沿用原始毫秒值，只有用户实际改过的字段才从输入框解析。校验 `invalid` / `total` 也要基于这套合并后的值。

### T2 超时提醒面板会被后台刷新重置回第一页

- 位置：`src/components/OvertimeDialog.tsx:38-53`（effect 依赖 `[active, settings]`）；根因在 `src/store.ts:242-246`（`publishSnapshot`）和 `src/store.ts:837`（`applyRemote`）
- 原因：`reloadFromDb` 和每次同步的 `applyRemote` 都会发布**新的对象引用**（`active`、`settings`、`sessions`），即使内容完全没变。effect 重跑后执行 `setSnapshotNow(now); setMode('choose'); setOpen(true)`。
- 触发：开启了 GitHub 备份，忘记结束计时，回到 App。提醒弹出，用户点"设置实际结束时间"开始改时间；1—3 秒后启动/回前台触发的同步完成 → `applyRemote` 发布新的 `settings` 引用 → 面板跳回三个按钮的选择页，再点进去时 `endInput` 被重置为默认值。其他标签页的广播同样会触发。
- 建议（两处都改）：
  1. 组件侧：effect 只依赖真正决定是否超时的原始值（`active?.sessionId`、`active?.runningSince`、`active?.ackAt`、`settings.overtimeHours`），并且面板已打开时不要重置 `mode`。
  2. 数据层：见 T3，内容未变时保持引用不变。

---

## P2 — 效率 / 卡顿

### T3 内容没变也重新发布整份状态，触发全量重算和重渲染

- 位置：`src/store.ts:837`（`applyRemote` 无条件 `setState({ sessions: result.merged, settings })`）、`src/store.ts:242-246`（`publishSnapshot`）、`src/store.ts:285`（每次回前台 / 每条广播都 `db.sessions.toArray()`）
- 代价：每次回到前台、每次同步（哪怕云端和本地完全一致）都会：整表读取 → 新的 `sessions` 数组引用 → `useBaseDaily` 的 `buildDaily` 对全部记录重算 → `Heatmap`（`memo` 依赖 `daily`，约 700 个绝对定位按钮）整体重渲染 → `lastSubject`、`useVisibleSessions`、`sessionsOnDay` 等全部失效。
- 建议：
  - `applyRemote`：只有 `result.changed` 为真时才发布 `sessions` / `settings`；
  - `publishSnapshot` / `reloadFromDb`：内容未变时沿用旧引用。可以在 meta 里维护一个"数据修订号"（任何会话写入，包括合并写入的 `toLocal`，都在同一事务内 +1），刷新时先读这个号，没变就跳过 `toArray()`；`active`、`settings` 用已有的 `sameTimer` / `compareSettings` 判断后保留旧对象。
  - 注意不要破坏 `adoptTimer` / `externalEpoch` 的过期操作检测。

### T4 每次回前台都完整下载并合并整个备份文件

- 位置：`src/store.ts:875`（`visibilitychange`）、`src/store.ts:688`（只有 30 秒节流）、`src/sync/merge.ts:215-221`（`compareSessions`）、`src/sync/merge.ts:244-258`
- 代价：没有任何"云端没变就跳过"的短路。每次回前台（间隔 ≥30 秒）都会下载整个文件 → base64 解码 → `JSON.parse` → 逐条 `checkSession` → 整表读取 → 合并。合并时，未变化的记录 `updatedAt` 和 `deleted` 都相等，`compareSessions` 会落到指纹比较，每条记录在一次同步里被 `JSON.stringify` 约 4 次，而且这些都发生在读写事务里。记录数随备考时间线性增长（墓碑也永久保留），文件超过 1MB 后 `getFile` 还要多发一次 raw 请求。
- 建议（从便宜到彻底）：
  1. `compareSessions` 先逐字段比较（含 segments 逐段比较），完全相同直接返回 0，只有真的不同才生成指纹；
  2. 记住上次成功同步时云端文件的 `sha`（内存即可，配置变化时清掉）；本次 GET 返回相同 `sha` 且本地 `dirty === false` 时，跳过解析和 `applyRemote`，直接 `finishSync`；
  3. 可选：GET 带 `If-None-Match`，304 时不下载正文；
  4. 非 dirty 的回前台拉取节流从 30 秒放宽到几分钟。

### T5 `useApp` 每次渲染都重新订阅

- 位置：`src/store.ts:101-109`
- 原因：`subscribe` 是内联箭头函数，每次渲染都是新引用，`useSyncExternalStore` 会在每次提交时退订再订阅。计时页每秒重渲染一次，页面上有 6 个以上的 `useApp` 调用。
- 建议：把 `subscribe` 提到模块作用域，作为稳定引用传入。

---

## P2 — 同步行为

### T6 回前台会无视退避和 Retry-After 立即重试

- 位置：`src/store.ts:875`、`src/store.ts:694-697`
- 触发：GitHub 返回 403/429 并带 `Retry-After: 3600`，`scheduleRetry` 已排好等待。此时本地有未同步改动，用户切出去再回来 → `visibilitychange` 走 `state.sync.dirty ? syncNow()`，`syncNow` 先 `clearTimeout(retryTimer)` 再立刻发请求。每回一次前台就多打一次，限流期间反复请求可能延长封禁。`scheduleSync` 是尊重 `retryTimer` 的，只有这条路径绕过了。
- 建议：记录"最早可重试时间"（来自限流提示时）；非手动的 `syncNow` 在此之前直接返回并保留已排的重试。手动同步可以照常绕过。

### T7 切到后台时不会冲刷已排队的同步

- 位置：`src/store.ts:601`（`SYNC_DELAY_MS = 1500`）、`src/store.ts:637-645`、`src/store.ts:873-877`
- 触发：点"结束" → 1.5 秒内锁屏或切走（手机上最常见的用法）。页面被挂起，防抖定时器不会触发，这段记录要等下次打开 App 才上传；期间在另一台设备上看不到它。本地数据没有丢。
- 建议：`visibilitychange` 变为 `hidden`（以及 `pagehide`）时，如果有排队中的 `syncTimer`，立即 `syncNow()`；或者对"结算了一条记录"这类改动不做防抖。注意不要和 T6 的退避冲突。

### T8 计时路径写入的记录没有经过和解析相同的规范化，可能导致每次同步都重复上传

- 位置：`src/store.ts:366-370`（`finished` 直接 `put`，没有走 `checkSession`）、`src/sync/merge.ts:80`（解析时会按 `start` 排序并重算 `startAt`）、`src/sync/merge.ts:251-258`
- 触发（少见）：计时中暂停，系统时钟被往回调，再继续 → 活动计时器里的段不是按时间升序。结算后本地保存的是乱序的段，`startAt` 取的是 `segs[0]`。上传后云端文件再被解析时会排序，指纹和本地不同；`updatedAt` 相同，按指纹字典序本地胜出 → `remoteChanged` 永远为真 → **此后每次同步都会 PUT 一次**，永不收敛。
- 建议：让所有写入会话的路径共用一个规范化函数（计时结算在写库前也过一遍 `checkSession` 的规范化），保证"本地存的"和"解析回来的"字节级一致。加一个性质测试：任意本地写入的会话 → `makeBackup` → `parseBackup` 后指纹不变。

---

## P3 — 校验缺口

### T9 设置里的日期没有范围限制，输错年份会让热度页卡死并同步到所有设备

- 位置：`src/sync/merge.ts:64-66`（`isValidDay`）、`src/sync/merge.ts:122-123`；渲染侧 `src/components/Heatmap.tsx:61-92`、`src/domain/aggregate.ts:82-90`
- 触发：初试日期误输成 `2207-12-25`，或备考开始日期输成 `1900-01-01`。两者都能通过校验。热度表要创建几万到上百万个按钮，`levelCounts` 逐天循环；这个设置还会被同步，所有设备的热度页都会卡住。`startDate` 晚于 `examDate` 也没有检查。
- 次要：`src/pages/SettingsPage.tsx:135`、`:143` 在日期输入框每次 `onChange` 都调 `updateSettings`，桌面端逐位输入年份时会连续弹出"保存失败"提示并产生多次写库。
- 建议：`checkSettings` 把两个日期限制在合理范围（例如 2000 年到 2100 年，和 `MAX_TIMESTAMP` 对齐）；注意已存在的越界设置要能回退而不是让整个备份解析失败。日期输入改为失焦时提交。

### T10 同一条记录内的时间段可以互相重叠，时长被重复计算

- 位置：`src/sync/merge.ts:70-82`（`checkSegments` 只排序不查重叠）、`src/components/SessionEditor.tsx:75-78`
- 触发：补录时填两段 `09:00–11:00` 和 `10:00–12:00`。保存成功，记为 4 小时（实际 3 小时），一天的总时长可以超过 24 小时。
- 建议：在编辑器保存前拒绝重叠的段并提示是哪两段。**不要**在 `checkSegments` 里直接拒绝，否则已有的重叠数据会让备份整体导入失败；解析层最多做合并或保持现状。

---

## 可选（把握较低）

### T11 `setSyncConfig` 在操作队列里等跨标签页锁

- 位置：`src/store.ts:543-552`
- `withSyncConfigLock` 获取锁最多等 10 秒，而它被包在 `serial(...)` 里面。如果另一个标签页在持锁的瞬间被系统冻结，这 10 秒内本标签页的暂停/结束等所有计时操作都会排队不动。文件头注释写的是"网络请求从不放进事务或这个队列里"，锁等待实际上在队列里。
- 建议：调换嵌套顺序为"先拿锁，再进队列"（`withSyncConfigLock(() => serial(() => rwTx(...)))`）。`dispatchSyncRequest` 是在队列外拿锁的，顺序一致，不会死锁。改之前请确认现有的锁相关测试仍然成立。

---

## 约束（和前两轮相同）

- 不修改 Dexie `version(1)` 的表定义；需要新状态就用 meta 表的新键，旧数据缺省值要能工作。
- 不修改科目 ID、统计口径、UI 视觉设计。
- 网络响应不在 IndexedDB 事务、操作队列或 Web Lock 内等待。
- 不删除、跳过或改写现有测试的断言；现有 182 项必须继续通过（默认、`Asia/Shanghai`、`America/New_York` 三个时区）。
- 不提交、不推送、不部署。
