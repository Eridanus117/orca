# Orca Fork macOS 发行与上游升级

本文说明如何维护 `Eridanus117/orca` 的 macOS 本地发行：官方 Orca 提供上游版本，
Fork 只保留少量可独立重放的本地能力，并与官方应用共享 Orca 用户数据。

目标不是持续追逐 `upstream/main`，而是让唯一长期 Fork 分支固定在一个可识别、
可回滚的官方 stable release tag 上，并把本地差异维持为短小、可独立删除的补丁队列。

## 版本策略

- 日常版本只选择最新的 stable tag，例如当前基线 `v1.4.147`。
- 不用 `-rc.N` 作为 Fork 基线；需要 RC 能力时等待其进入 stable，或在独立临时分支验证，
  不污染长期 Fork 分支。
- `upstream/main` 只用于提前发现冲突，不直接作为日常安装基线。
- 临时基于某个上游 commit 时，必须记录原因；第一个包含该 commit 的 release tag
  发布后，立即回到 tag-to-tag 升级。
- 新 tag 必须包含当前上游基线。若祖先校验失败，不做强行 rebase，也不把 Fork
  回退到更旧的 tag。

当前采用的上游基线是 `v1.4.147`。下一次升级必须从 `v1.4.147` 到更高的 stable tag，
不再使用早期的过渡 commit `80e632282c87fce15ea80a7db4105ea68a509f6b`
作为日常锚点。

## 补丁队列边界

Fork 提交按以下 12 个能力单元排列；提交正文的 `Replays:` 保存被吸收的旧 commit：

1. 本地发行身份与共享 CLI。
2. stable release tag 同步。
3. Qoder CLI 身份、hook 与 session resume。
4. Qoder/terminal stateful query 路由。
5. Folder Workspace 下按 lineage 聚合跨仓 worktree。
6. runtime 与公开 CLI 的 folder lineage 管理。
7. Folder Task Group 一等展示。
8. Windows Codex hook shell 兼容。
9. GitHub CLI proxy/auth preflight。
10. daemon session 安全的本地升级与 release plumbing。
11. macOS 固定签名与 packaging-load 兼容。
12. Computer Use helper 收口与单份 rollback snapshot。

升级时按提交顺序重放这些补丁。若官方已经等价实现某项能力，先验证数据迁移和 UI
行为，再单独删除对应补丁；不要借升级顺手重构其他代码。

## 长期分支与 worktree

本地只保留官方观察 checkout；Fork 的长期真相是远端 canonical 分支与已安装应用，
不保留常驻 Fork worktree：

```text
/Users/a123/workspace/sources/orca
└── main                         # 官方观察线，不放 Fork commit

origin/fork/macos-local           # 唯一长期 Fork 分支
~/Applications/Orca Fork.app     # 当前已验收的本地运行版本
```

功能开发、reference replay 和升级候选 worktree 都是临时资产：用 personal Docket leaf
作为 owner，通过 Registrar 从 `origin/fork/macos-local` 创建；补丁推回 canonical 并
验证后，通过 Registrar closeout。日常开发和测试可以在 Orca 终端完成；会退出或替换
Orca.app 的安装、升级与恢复命令放在 Kitty/cmux 等外部控制终端执行。上游 PR 尚未关闭时
保留远端 head branch 即可，不需要永久占用本地 worktree。

每次改写补丁队列前，为所有独立 tip 创建 `archive/orca-fork/<date>/...` 本地 annotated
tag。archive tag 是恢复点，不是第二条开发主线，也不需要常驻 worktree。远端仍只发布
`fork/macos-local`；archive tag 是否推送另行决定。

## 首次建立稳定的本地签名

macOS 的 Documents、Desktop、Downloads 等隐私授权不仅识别 bundle ID，也校验应用的
代码指定要求（designated requirement）。若每次构建都使用新的 ad-hoc `cdhash`，
系统会把同名的 `Orca Fork.app` 视为不同代码，反复要求授权。

每台用于构建 Fork 的 Mac 只需初始化一次本地签名身份。先预演，再写入登录钥匙串：

```bash
pnpm fork:mac signing-setup
pnpm fork:mac signing-setup --apply
```

脚本会：

1. 把当前用户 trust settings 备份到
   `~/Library/Application Support/Orca Fork Installer/signing-trust-backups/`。
2. 创建名为 `Orca Fork Local Code Signing` 的自签名 code-signing 证书。
3. 把私钥以不可导出方式写入登录钥匙串，并只授权 `/usr/bin/codesign` 使用。
4. 将证书的信任范围限制为代码签名。

`build`、`install` 和 `update` 会自动选择这个精确身份；若机器使用已有的受管证书，
可显式设置 `ORCA_FORK_SIGN_IDENTITY` 覆盖。未找到可用身份时构建直接失败，不再静默
退回 ad-hoc 签名。

用以下命令确认安装版的指定要求包含固定 bundle ID 与证书锚点，而不是只有
`cdhash`：

```bash
pnpm fork:mac status
codesign --verify --deep --strict "$HOME/Applications/Orca Fork.app"
codesign -d -r- "$HOME/Applications/Orca Fork.app"
```

从旧 ad-hoc 版本迁移到稳定签名后，macOS 可能要求最后授权一次；之后正常更新会复用
同一指定要求。恢复旧的 ad-hoc 应用快照则可能再次触发授权。

## 选择候选 release tag

进入本次 personal Docket leaf 对应的临时 worktree，确认干净并同步官方 tag：

```bash
cd /Users/a123/workspace/worktrees/<orca-upgrade-worktree>
git status --short
git fetch upstream --tags --prune
```

只查看 stable 候选：

```bash
git tag --list 'v*' --sort=-version:refname \
  | rg '^v[0-9]+\.[0-9]+\.[0-9]+$' \
  | head -20

```

不要使用未过滤的 `git describe` 选版本；仓库中存在不属于发行版本的 tag。

设置本次升级变量：

```bash
OLD_BASE="v1.4.147"
NEW_TAG="vX.Y.Z"
NEW_BASE="$(git rev-parse "${NEW_TAG}^{commit}")"
BACKUP_TAG="archive/orca-fork/$(date +%F)/canonical-before-${NEW_TAG}"
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

先建立不可移动的本地恢复点，再查看脚本将执行的 tag 升级：

```bash
git tag -a "$BACKUP_TAG" HEAD -m "Archive Orca Fork before ${NEW_TAG} upgrade"
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
git range-diff "$OLD_BASE..$BACKUP_TAG" "$NEW_BASE..HEAD"
git log --reverse --oneline "$NEW_BASE..HEAD"
git diff --stat "$NEW_BASE..HEAD"
```

然后执行最低验证：

```bash
pnpm exec vitest run --config config/vitest.config.ts \
  config/scripts/orca-fork-macos.test.mjs \
  config/scripts/verify-packaged-daemon-entry.test.mjs
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
2. 把现有应用和共享 profile 保存为 v3 配对快照；发布成功后只保留最近一份有效快照，
   同时清理旧 schema 和失败的 partial 历史。
3. 原子替换 `/Users/a123/Applications/Orca Fork.app`。
4. 在后台重新启动 Fork；新 runtime ready 后再清理旧应用。

更新路径不允许向 desktop、renderer 或 daemon 使用 `KILL`/`TERM` 兜底。正常版本先走
IPC graceful shutdown；只有同时满足“PPID 为 1、可执行路径精确落在待替换 bundle、
二次校验仍为同一进程”的旧版 Computer Use 孤儿 helper，finalizer 才允许发送一次
`SIGTERM`，超时就中止更新，不升级为 `SIGKILL`。

若正在运行的是尚不支持 `localFork.requestUpdateQuit` 的旧 Fork，命令会停止在 bootstrap
边界：先用 `Command + Q` 正常退出旧 desktop，再原样重跑
`pnpm fork:mac update --apply`。第二次执行允许旧 detached daemon 存活，但仍拒绝主进程、
renderer、GPU helper 或 parcel watcher。

只安装已构建 bundle 的 `install --apply` 与恢复快照的 `rollback --apply` 仍是停机
操作；执行前必须正常退出官方 Orca 与 Orca Fork 的全部进程。

更新完成并自动拉起 `~/Applications/Orca Fork.app` 后，至少验证：

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
git switch -c restore/fork-before-${NEW_TAG} "$BACKUP_TAG"
```

先在恢复分支检查与验证，不直接 reset 唯一长期分支；确认需要回退后再按正常分支流程
替换 canonical。

## 每次升级的完成条件

- 当前 Fork 明确基于一个 release tag，或有已记录的临时 commit 例外。
- `range-diff` 中每个本地能力都能对应到升级前的补丁。
- 定向测试、typecheck、构建、安装和五项手工冒烟全部通过。
- 更新只通过正常退出完成交接，daemon-backed agent 在应用替换期间持续存活。
- 远端更新使用 `--force-with-lease`，没有覆盖他人新提交。
- 升级结果、选用 tag、被删除或新增的 Fork 补丁已写入对应 docket issue。
- 安装失败时，应用与共享 profile 能成对回滚。
- 更新完成后 snapshot 历史只保留一份有效 v3 配对快照；rollback 期间的临时补偿点在
  完成后也收敛回一份。
- 首次成功生成 v3 配对快照后，安装器会删除已识别的 v1 仅 App 备份；未知 schema
  不自动删除，避免误伤人工或未来版本资产。
- canonical 推送完成后，升级 worktree 与本地临时分支已通过 Registrar 收口；本地不
  留第二份长期 Fork checkout。
