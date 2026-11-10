# 代码审查委托：数据层健壮性修复（R1—R8）

请审查提交 `88b7396`（分支 `fix/data-layer-robustness`，基线 `d22d65e`）。这是纯前端 PWA（React + TypeScript + Dexie/IndexedDB，通过 GitHub Contents API 同步备份），没有后端服务器。本次只改了数据层和必要的调用代码，没有改 UI 设计。

问题来源见 `review/backend-review.md`（修复前的审查报告），修复说明见 `review/fix-summary.md`。本文件说明改了什么、在哪里、靠什么保证正确，以及作者自己最不放心、希望你重点挑战的地方。

```bash
git diff d22d65e..88b7396 -- src          # 业务代码改动（约 1000 行，主体在 src/store.ts）
git diff d22d65e..88b7396 --stat
git show 88b7396:review/store.review.test.ts | sed -n 180,250p   # 两个改写过的 R1 用例（196 行、221 行起）
```

## 审查要求

- 以**找缺陷**为目标：数据丢失、重复计时、错误覆盖、状态不一致、死锁或永久挂起、未处理的 Promise 拒绝、Token 泄漏。
- 测试全部通过不等于正确。请把测试本身也当作审查对象：有没有断言过宽、注入方式不成立、或者实际没覆盖到要保证的不变量。
- 发现的问题请给出文件和行号、触发条件（具体的操作顺序或输入）、后果；能写成可复现测试最好。
- 不要用真实学习数据或真实 GitHub Token，不要向真实仓库写入，不要推送或部署。

## 约束（修复时遵守的规则，请核对是否被违反）

1. 不得修改 Dexie 既有的 `version(1)` 定义；结构变更只能新增 version 和迁移。本次**没有**新增 schema version。
2. 不得修改科目 `id`（`src/domain/subjects.ts`）。
3. 不清空数据库，不牺牲历史记录。
4. Token 不得进入日志、导出备份或仓库。
5. 保留现有行为：计时、暂停、继续、换科目、超时修正、统计、导入导出、备份，以及"少于 1 秒的计时不保存"。
6. 网络请求不得放进 IndexedDB 事务，也不得放进阻塞本地操作的写入队列。

## 改动总览

| 文件 | 改动 |
|---|---|
| `src/store.ts` | 主体重写：操作队列 + 事务化状态转换、版本核对、同步任务（代次/取消/退避重试/多轮）、广播刷新 |
| `src/sync/github.ts` | 请求截止时间与取消（含响应体读取）、`Retry-After`/限流解析、错误分类 `isTransient`/`isAbort` |
| `src/sync/merge.ts` | 备份与记录校验、逻辑时钟 `nextRevision`、确定性冲突规则、合并重写 |
| `src/db/db.ts` | 只扩充类型：`SyncMeta.seq?`（:10）、meta 键 `timerRev`（:16） |
| `src/domain/types.ts` | `ActiveTimer.rev?`（:33） |
| `src/hooks/useStats.ts` | 计时中排除与计时器同 id 的记录（:10—12），兼容旧版本留下的半提交状态 |
| `src/components/SessionEditor.tsx` | 等待保存/删除的结果再提示；传入打开时的版本（:69、:152） |
| `review/fix.regression.test.ts` | 新增 51 项回归测试 |
| `review/store.review.test.ts` | 改写 2 个 R1 用例的故障注入方式（原因见下文"测试"） |

## 核心机制（请重点核对）

### 1. 操作队列与事务（R1、R3）

- `serial()`（`src/store.ts:118`）是本标签页内的串行队列，前一个操作失败不会阻塞后续操作。
- `rwTx()`（:127）是覆盖 `sessions` 和 `meta` 两张表的 Dexie 读写事务。
- 每个会改数据的操作都是"在事务里读取数据库当前状态 → 决定变更 → 写入 → 提交成功后才 `setState` 发布"。
- 计时操作 `timerOp()`（:322）：
  - 时间 `at` 在**调用时**捕获，不在执行时；
  - 在同一个事务里依次写入完成的 Session、新的 activeTimer（或 null）、`timerRev+1`，以及待同步标记 `bumpDirtyInTx()`（:142）；
  - 状态转换规则在 `planTimer()`（:284），复用 `src/domain/timer.ts` 中原有的纯函数。
- `reloadFromDb()`（:256）也在队列里执行，并用只读事务读取一致的快照（`readSnapshotInTx`，:186）。

### 2. 过期操作检测（R2）

三层核对，任一不一致都拒绝操作，刷新本标签页并提示：

1. 在事务内，`sameTimer(current, expected)`（:160）比较 `sessionId`、`rev`、`runningSince`、`segments.length`。`expected` 是**执行时**本标签页内存中的计时器。
2. 在事务内，比较数据库的 `timerRev` 与本标签页已知的 `knownTimerRev`（:205）。即使计时器经历"开始又结束、回到 null"，这个修订号也会变化。
3. 外部刷新代次 `externalEpoch`（:207）：点击时捕获。如果执行前内存中的计时器被其他标签页的结果替换（通过 `adoptTimer`，:209，在 reload 或陈旧拒绝时调用），也拒绝。用来防止"点击发生在看到别人改动之前，执行却发生在之后"所造成的时间回溯和重叠计时。这一层是随机双标签页测试发现问题后补的。

记录的编辑和删除走 `sessionOp()`（:405），通过 `expectedUpdatedAt` 核对版本。

`BroadcastChannel` 只在 `installGlobalListeners()`（:792）中创建，用于通知其他标签页刷新；测试环境不会调用它。

### 3. 同步（R3、R4、R7、R8）

- `syncNow()`（:641）：同一代次只运行一个任务，并发调用会共享它；带 `throttle` 的调用在有任务运行时也会加入同一任务。
- `runSync()`（:670）的流程是：GET（不在队列或事务里）→ `applyRemote()`（:738，排队并在事务中基于本地最新数据合并、写回，生成上传文本并记录 `seq`）→ PUT → `finishSync()`（:764，在事务中比较 `seq`，期间有新改动则保持 dirty，最多 `MAX_ROUNDS=3` 轮）。
- 代次与取消：`syncGen`、`syncAbort`、`invalidateSync()`（:584）。每个 `await` 之后调用 `ensure()`。`applyRemote` 和 `finishSync` 还会在事务里核对数据库中的 `syncConfig`，以发现其他标签页关闭或切换了备份。
- 重试：`scheduleRetry()`（:606）按 5s×2ⁿ 退避，上限 15 分钟，加 20% 抖动，最多 8 次。`Retry-After` 最多遵守 1 小时。`PermanentSyncError`（云端数据损坏或版本不支持）以及非暂时性的 `GitHubError` 不重试。退避等待期间，`scheduleSync()`（:596）不会额外触发同步。
- 传输层：`request()`（`src/sync/github.ts:99`）用 `AbortController` 设置截止时间（GET 30 秒、PUT 60 秒），并用 `Promise.race` 保证即使 `fetch` 不理会信号也会结束；`untilAborted()`（`src/store.ts:622`）在 store 层再加一道取消。

### 4. 校验与合并（R5、R6）

- `parseBackup()`（`src/sync/merge.ts:136`）：
  - 文件级问题直接抛错：不是 JSON、`app` 不对、`version` 不是 1（缺省按 1 处理）、设置损坏；
  - 单条记录逐条校验，损坏的放进 `invalid` 隔离。这是为了让原有测试"过滤掉损坏的记录"继续通过；调用方 `importBackupText`（`src/store.ts:534`）和 `runSync` 只要看到 `invalid` 非空，就整体拒绝。
- `checkSession()`（:75）：
  - 要求科目在已知列表中；
  - 时间戳必须是 [0, 2100-01-01] 范围内的有限数；
  - 时间段必须满足结束晚于开始，非删除记录至少有一段；
  - 墓碑的时间段损坏时置空，保留删除语义。
- `nextRevision()`（:44）：`max(当前时间, 已见版本 + 1)`，用作 `updatedAt` 的逻辑时钟。没有新增字段，旧数据和旧版 App 都兼容。
- `compareSessions()`（:205）：版本大的胜出；版本相同时墓碑胜出；仍相同时比较规范化内容的字典序。`compareSettings()`（:213）同理。`mergeSessions()`（:220）先在本地和远端内部各自去重，再合并。

## 测试

- 修复后：`npm test` 32/32；`npm run test:review` 在默认时区、`TZ=Asia/Shanghai`、`TZ=America/New_York` 下均为 136/136；`npx tsc -p tsconfig.review.json --noEmit` 通过；`npm run build` 通过。并发相关的两个测试文件在两个时区各重复运行 10 次，全部通过。
- 测试环境：Node + Vitest 5、真实 Dexie 4 + fake-indexeddb（它的调度使用真实的 `setImmediate`）、伪造的 `Date`/`setTimeout`、模拟网络。
- **改写了 2 个原审查用例**（`[R1] stop must leave…`、`[R1] switching subject must not expose…`）：
  - 原来的注入方式是把单个表操作挂在测试外部的 Promise 上。诊断证实，被延迟的写入会离开 Dexie 事务区，以独立的隐式事务执行，所以测到的是测试自己造成的拆分。
  - 改为在每个写入点（Session、activeTimer、syncMeta）用 `Dexie.Promise.reject` 让事务中断，断言数据库保持完全回滚，并且重试后只有一条记录。
  - 在基线代码上，这两个用例分别在第 209 行和第 235 行的不变量断言处失败。
  - **请判断这次改写是否保留了原用例的意图，有没有放宽。**
- 两个原 R3 用例（前台重读、拉取期间删除）同样用外部 Promise 注入，没有修改，现在通过。但它们证明的是排队顺序，不是事务原子性。
- 新增 51 项回归测试（`review/fix.regression.test.ts`），每个用例结束时断言没有未处理的 Promise 拒绝。其中一个用例用第二个 Dexie 连接并发轮询，证明 60 次换科目中从未出现半提交的状态。
- 在基线代码上运行全部 136 项：63 失败。部分失败只是因为旧 API 没有返回值，并不能证明存在缺陷。

## 作者自己的疑点（请优先审查）

1. **Dexie 事务内使用原生 async/await。** `getMeta`/`setMeta`（`src/db/db.ts`）是原生 async 函数，在事务内被 await，依赖 Dexie 的 zone 机制。Node 中可以工作，但没有在 Safari/iOS 上实测。是否存在事务被提前提交（`PrematureCommitError`）而测试环境恰好没暴露的路径？
2. **`externalEpoch` 是否过于激进。**
   - `init()` 的第一次 `publishSnapshot` 会递增代次。如果 UI 在加载完成前就允许点击，这次点击会被拒绝。
   - 广播触发的 reload 会让"刚刚点下但还在排队"的操作被拒绝，这是有意为之。
   - 请评估实际使用中是否会频繁出现误拒绝（用户需要再点一次）。
3. **`sameTimer` 只比较部分字段**（:160），没有比较 `ackAt` 和最后一段的数值。是否存在 `rev` 相同但内容不同的情况？
4. **`updateSettings` 先乐观更新内存**（:472），提交失败才回滚。这是为了避免受控 `<select>`/日期输入框的异步更新问题。它与"先提交再发布"的原则不一致，请判断是否会让排在前面的 reload 产生可见的闪回，或留下不一致。
5. **`publishSnapshot` 在配置不同时调用 `invalidateSync()`**（:214）。`setSyncConfig` 持久化之后、`setState` 之前，如果插入一次 reload，也会触发它。作者认为无害，请核对。
6. **`applyRemote` 在事务内对全量记录做 `JSON.stringify`。** 5 年约 2.2 万条记录，备份约 4 MB，会在事务中同步执行。是否会因主线程长时间占用影响 Safari 上 IndexedDB 事务的存活？
7. **`checkSession` 要求科目必须在已知列表里。** 如果用户的历史数据中存在未知科目，整个备份都会被拒绝导入，而且同步会进入"永久错误"状态并暂停。这条规则是否过严？
8. **时间戳上限固定为 2100 年**，不随当前时间变化。时钟严重偏快的设备产生的版本会一直在合并中占优。
9. **`runSync` 的错误分类。** Dexie 错误（例如配额不足）不是 `GitHubError`，也不是 `PermanentSyncError`，会被当作暂时性错误退避重试。这样是否合适？
10. **冲突语义是"版本大者胜出"。** 两台设备离线时，一台删除、另一台随后编辑，编辑会胜出，记录会恢复。这被视为可接受的取舍；请判断是否违背了"墓碑不能被普通旧记录意外复活"这条要求。
11. **本地 IndexedDB 操作没有超时。** 如果某个事务永远不结束，本标签页的队列会永久阻塞。
12. **`useStats` 的去重**（`src/hooks/useStats.ts:10`）只在数据库层面测过对应场景，hook 本身没有单元测试。

## 未覆盖的范围（不要据测试结果推断这些已验证）

真机 iOS 主屏幕 PWA 的杀后台、锁屏、存储回收、低存储空间，Service Worker 升级，长期耐久运行，真实 GitHub 的限流与大文件（>1 MB）raw 读取，Safari 上的 `BroadcastChannel` 行为。
