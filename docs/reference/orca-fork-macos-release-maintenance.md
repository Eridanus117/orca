# Orca Fork macOS 发行与上游升级

本文说明如何维护 `Eridanus117/orca` 的 macOS 本地发行：官方 Orca 提供上游版本，
Fork 只保留少量可独立重放的本地能力，并与官方应用共享 Orca 用户数据。

目标不是持续追逐 `upstream/main`，而是把日常安装版本固定在一个可识别、可回滚的
官方 release tag 上。

## 版本策略

- 日常版本默认选择最新的 stable tag，例如 `v1.4.144`。
- 只有明确需要尚未进入 stable 的官方能力时，才选择 `-rc.N` tag。
- `upstream/main` 只用于提前发现冲突，不直接作为日常安装基线。
- 临时基于某个上游 commit 时，必须记录原因；第一个包含该 commit 的 release tag
  发布后，立即回到 tag-to-tag 升级。
- 新 tag 必须包含当前上游基线。若祖先校验失败，不做强行 rebase，也不把 Fork
  回退到更旧的 tag。

当前 Fork 是一次性过渡状态：其上游基线为
`80e632282c87fce15ea80a7db4105ea68a509f6b`，比 `v1.4.146-rc.0` 多 19 个
官方提交。因此不要把当前分支 rebase 回 `v1.4.146-rc.0`；等待第一个包含该基线的
新 release tag，再开始常规的 tag-to-tag 升级。

## 补丁队列边界

Fork 提交应按能力分组，避免把不同能力揉进同一提交：

1. 侧边栏展示：Folder Workspace 下按 lineage 聚合跨仓 worktree。
2. 工作区操作：通过公开 CLI 管理 Project Group、Folder Workspace 与项目归属。
3. 本地发行：应用身份、共享 profile、安装、升级和回滚。
4. Agent 集成：Qoder 身份识别、hook 和 session resume。
5. 更新交接：正常退出 desktop、保留 detached daemon、替换应用并后台拉起。

升级时按提交顺序重放这些补丁。若官方已经等价实现某项能力，先验证数据迁移和 UI
行为，再单独删除对应补丁；不要借升级顺手重构其他代码。

## 选择候选 release tag

先确认工作区干净并同步官方 tag：

```bash
cd /Users/a123/work/worktrees/zuhe
git status --short
git fetch upstream --tags --prune
```

查看 stable 与 RC 候选：

```bash
git tag --list 'v*' --sort=-version:refname \
  | rg '^v[0-9]+\.[0-9]+\.[0-9]+$' \
  | head -20

git tag --list 'v*' --sort=-version:refname \
  | rg '^v[0-9]+\.[0-9]+\.[0-9]+-rc\.[0-9]+$' \
  | head -20
```

不要使用未过滤的 `git describe` 选版本；仓库中存在不属于发行版本的 tag。

设置本次升级变量：

```bash
# 当前一次性过渡基线：
OLD_BASE="80e632282c87fce15ea80a7db4105ea68a509f6b"
# 进入 tag-to-tag 后改为上次采用的 tag，例如：
# OLD_BASE="v1.4.147"
NEW_TAG="vX.Y.Z"
NEW_BASE="$(git rev-parse "${NEW_TAG}^{commit}")"
BACKUP_BRANCH="backup/fork-macos-local-before-${NEW_TAG}"
```

`OLD_BASE` 是上次实际采用的基线，不要每次临时猜测，也不要用当前
`upstream/main` 替代。每次升级完成后，把本次 `NEW_TAG` 写入 docket 升级记录；它
就是下次升级的 `OLD_BASE`。

验证新 tag 确实继承当前基线：

```bash
git merge-base --is-ancestor "$OLD_BASE" "$NEW_BASE"
git rev-list --left-right --count "$OLD_BASE...$NEW_BASE"
```

第一条命令非零退出时停止。常见原因是选中了旧 tag、官方从 release 分支切 tag，
或本地 tag 尚未更新；先查清拓扑，不要继续 rebase。

## 预演冲突范围

分别列出本地补丁和新上游修改过的文件：

```bash
git diff --name-only "$OLD_BASE..HEAD" | sort > /tmp/orca-fork-files
git diff --name-only "$OLD_BASE..$NEW_BASE" | sort > /tmp/orca-upstream-files
comm -12 /tmp/orca-fork-files /tmp/orca-upstream-files
```

交集只表示“需要重点检查”，不等于一定冲突。若交集涉及共享 profile、worktree
持久化模型或侧边栏数据结构，先停下来做迁移设计；这些区域不能只以“能编译”为完成。

## 重放 Fork 补丁

先查看脚本将执行的 tag 升级：

```bash
git branch "$BACKUP_BRANCH" HEAD
pnpm fork:mac sync --from "$OLD_BASE" --base "$NEW_TAG"
```

确认计划后，把当前基线之后的 Fork 提交整体搬到新 tag：

```bash
pnpm fork:mac sync --from "$OLD_BASE" --base "$NEW_TAG" --apply
```

脚本发现冲突会自动 `git rebase --abort`，源分支保持不变。先查看失败输出，再手工重放
补丁并逐个处理：

```bash
git rebase --onto "$NEW_BASE" "$OLD_BASE"
git status
git add <resolved-files>
git rebase --continue
```

若无法确认冲突处理后的语义等价，立即回退：

```bash
git rebase --abort
```

不要为了通过 rebase 删除未知的官方逻辑。尤其要保留 macOS、Linux、Windows 和 SSH
四种运行边界。

## 验证补丁没有漂移

先对比 rebase 前后的补丁语义：

```bash
git range-diff "$OLD_BASE..$BACKUP_BRANCH" "$NEW_BASE..HEAD"
git log --reverse --oneline "$NEW_BASE..HEAD"
git diff --stat "$NEW_BASE..HEAD"
```

然后执行最低验证：

```bash
pnpm exec vitest run --config config/vitest.config.ts \
  config/scripts/orca-fork-macos.test.mjs
pnpm typecheck
pnpm fork:mac status
pnpm fork:mac update
```

`pnpm fork:mac update` 默认只展示计划，不修改已安装应用。计划和 diff 都符合预期后，
再构建并发起更新：

```bash
pnpm fork:mac update --apply
```

执行更新前必须退出官方 Orca；Orca Fork 可以保持运行。当前 Fork runtime 收到更新
请求后会走正常退出流程，desktop 退出但 daemon-backed agent 保持运行。脱离应用进程
的 finalizer 随后执行以下动作：

1. 确认 renderer、主进程和普通 helper 已退出，只允许 detached daemon 存活。
2. 把现有应用和共享 profile 保存为一组配对快照。
3. 原子替换 `/Users/a123/Applications/Orca Fork.app`。
4. 在后台重新启动 Fork；新 runtime ready 后再清理旧应用。

更新路径不允许用 `TERM` 或 `KILL` 作为兜底。若正在运行的是尚不支持
`localFork.requestUpdateQuit` 的旧 Fork，命令会停止在 bootstrap 边界：先用
`Command + Q` 正常退出旧 desktop，再原样重跑 `pnpm fork:mac update --apply`。
第二次执行允许旧 detached daemon 存活，但仍拒绝主进程、renderer、GPU helper 或
parcel watcher。

只安装已构建 bundle 的 `install --apply` 与恢复快照的 `rollback --apply` 仍是停机
操作；执行前必须正常退出官方 Orca 与 Orca Fork 的全部进程。

更新完成并自动拉起 `/Applications/Orca Fork.app` 后，至少验证：

1. 原有项目、Folder Workspace、worktree 与 terminal 仍可见。
2. Folder Workspace 下的跨仓 worktree 仍按事项聚合。
3. Qoder/Codex hook 状态与 session resume 正常。
4. 更新前的 daemon-backed agent 可继续交互，没有生成重复 session。
5. 官方 Orca 与 Orca Fork 不会同时运行。

## 推送与回滚

rebase 会重写 Fork 提交。检查无误并取得明确确认后，才更新远端分支：

```bash
git push --force-with-lease origin HEAD:fork/macos-local
```

应用或共享 profile 验证失败时，先退出两个 Orca 应用，再恢复最近一组配对快照：

```bash
pnpm fork:mac rollback
pnpm fork:mac rollback --apply
```

回滚只处理本地应用与共享 profile，不回退 Git 分支。Git 补丁需要回到升级前状态时：

```bash
git reset --keep "$BACKUP_BRANCH"
```

执行任何 reset 前先确认当前工作区没有需要保留的未提交改动。

## 每次升级的完成条件

- 当前 Fork 明确基于一个 release tag，或有已记录的临时 commit 例外。
- `range-diff` 中每个本地能力都能对应到升级前的补丁。
- 定向测试、typecheck、构建、安装和五项手工冒烟全部通过。
- 更新只通过正常退出完成交接，daemon-backed agent 在应用替换期间持续存活。
- 远端更新使用 `--force-with-lease`，没有覆盖他人新提交。
- 升级结果、选用 tag、被删除或新增的 Fork 补丁已写入对应 docket issue。
- 安装失败时，应用与共享 profile 能成对回滚。
