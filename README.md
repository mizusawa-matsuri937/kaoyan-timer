# 考研计时

408 考研学习计时器：选科目 → 计时 → 自动统计各科 / 408 汇总 / 数学汇总 / 总时长，并用 GitHub 风格热度表展示每天的学习强度。

- **纯前端 PWA**：没有服务器，不存在“服务器挂了”的问题，断网也能用
- **数据三重保险**：手机本地 IndexedDB（主库）+ 自动备份到你的 GitHub 私有仓库 + 手动导出 JSON
- **计时精准**：只记录开始/暂停的时间戳，锁屏、杀后台、刷新、重启都不会丢秒

## 热度等级

| 颜色 | 当天学习时长 |
|---|---|
| 最浅（灰白） | 没有学习 |
| 第 1 级 | 1 小时以内 |
| 第 2 级 | 1–5 小时 |
| 第 3 级 | 5–12 小时 |
| 最深 | 12 小时以上 |

跨午夜的学习会按实际时间拆到两天。

## 第一次部署（只需做一次）

1. 在 GitHub 新建**公开**仓库 `kaoyan-timer`（名字可以改，网址会跟着变）。
2. 推送代码：
   ```bash
   git remote add origin https://github.com/<你的用户名>/kaoyan-timer.git
   git push -u origin main
   ```
3. 仓库 **Settings → Pages → Build and deployment → Source** 选 **GitHub Actions**。
4. 等 Actions 跑完（约 1 分钟），访问 `https://<你的用户名>.github.io/kaoyan-timer/`。

以后每次 `git push`，都会自动跑测试、构建、发布。

## 在 iPhone 上安装

1. 用 **Safari** 打开上面的网址 → 点「分享」→「添加到主屏幕」。
2. **之后一律从主屏幕图标打开。**主屏幕 App 的数据和 Safari 标签页是分开存的，而且只有主屏幕 App 不会被 Safari 的“7 天未访问自动清理”影响。

## 开启 GitHub 自动备份（强烈建议）

1. 新建一个 **Private** 仓库，例如 `kaoyan-data`（勾选 Add a README）。
2. GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate new token：
   - Repository access：**Only select repositories** → 只选 `kaoyan-data`
   - Permissions → Repository permissions → **Contents：Read and write**
   - 有效期选最长
3. 打开 App →「设置」→ 填用户名、仓库名、Token →「开启备份」。

每结束一段计时、补录 / 修改 / 删除后，都会自动推送一次（每次都是一个 git 提交，可以回滚到任意历史版本）。断网时会排队，联网后补推。
换手机或数据丢失：在新设备上填同样的信息点「开启备份」，就会自动恢复。Token 只保存在设备本地，不会出现在代码仓库里。

## 本地开发

```bash
npm install
npm run dev      # http://localhost:5173/kaoyan-timer/
npm test         # 单元测试
npm run build
```

### 代码结构

```
src/domain/   纯逻辑：科目、计时状态机、按日切分、汇总、热度等级、连续天数（有单元测试）
src/db/       IndexedDB（Dexie）表结构
src/sync/     GitHub 备份与合并逻辑（有单元测试）
src/store.ts  全局状态与所有操作（写入串行队列）
src/pages/    计时 / 热度 / 统计 / 设置 四个页面
```

修改数据库结构时只能在 `src/db/db.ts` 里**新增** `version(2)`，不要改 `version(1)`，否则旧数据无法迁移。
科目的 `id` 一旦使用就不要再改（历史记录靠它关联），名字和颜色可以随意改。
