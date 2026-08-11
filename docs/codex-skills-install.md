# 把 Reasonix 里的 Skills 装到 Codex

> 用途：把当前 harness（Reasonix）里安装的 skills 同步到 OpenAI Codex。
> 来源仓库：https://github.com/cloudflare/skills（Cloudflare 官方，Apache-2.0，2.6k stars，README 明确支持 OpenAI Codex）
> Codex skills 目录：`~/.codex/skills/`（文档 https://developers.openai.com/codex/skills/）

## 一、当前安装的 skills（来源分类）

### A. 用户级安装（11 个，全部来自 cloudflare/skills 仓库）

| skill | 作用 | 仓库路径 |
|---|---|---|
| agents-sdk | 用 Cloudflare Agents SDK 构建 AI agent | `skills/agents-sdk/` |
| cloudflare | Cloudflare 平台全栈技能（Workers/Pages/存储/AI/网络/安全/IaC） | `skills/cloudflare/` |
| cloudflare-email-service | 收发事务邮件（Email Sending + Routing） | `skills/cloudflare-email-service/` |
| cloudflare-one | Zero Trust / SASE（Access、Gateway、WARP、Tunnel、Magic WAN、DLP、CASB） | `skills/cloudflare-one/` |
| cloudflare-one-migrations | 从 Zscaler/Palo Alto/旧 VPN 迁移到 Cloudflare One | `skills/cloudflare-one-migrations/` |
| durable-objects | Durable Objects（状态协调/RPC/SQLite/告警/WebSocket） | `skills/durable-objects/` |
| sandbox-sdk | Cloudflare Sandbox SDK（注：仓库 main 已拆分为 sandbox-stable / sandbox-next） | `skills/sandbox-sdk/`（旧） |
| turnstile-spin | Turnstile 验证码端到端集成 | `skills/turnstile-spin/` |
| web-perf | Core Web Vitals 审计（LCP/INP/CLS/TBT…） | `skills/web-perf/` |
| workers-best-practices | Workers 开发最佳实践 | `skills/workers-best-practices/` |
| wrangler | 部署管理 Workers/KV/R2/D1/Vectorize/Queues/Workflows | `skills/wrangler/` |

### B. Reasonix 内置 skills（约 30 个，**无公开安装源**，打包在 Reasonix 程序内）

架构/设计：api-design-principles、architecture-patterns、microservices-patterns、cqrs-implementation、event-store-design、projection-patterns、postgresql-table-design、saga-orchestration、workflow-orchestration-patterns、mcp-builder
工程/协作：code-review-excellence、debugging-strategies、e2e-testing-patterns、git-advanced-workflows、doc-coauthoring、frontend-design、init、install-capability、reasonix-guide
极简主义：ponytail、ponytail-audit、ponytail-help、ponytail-review
内置子代理（工具而非文件）：explore、research、review、security-review、test、sast-configuration、temporal-python-testing

> 说明：B 类无法通过公开链接安装到 Codex。Codex 本身自带部分等价能力（如 review/security review 通过 AGENTS.md 约定）。若确实需要，只能从 Reasonix 内部提取或让 Codex 按名字手写等价 skill。

---

## 二、给 Codex 的安装提示词（直接复制这段）

```markdown
请为我把 Cloudflare 官方 Agent Skills 安装到本机 Codex。

【来源仓库】
https://github.com/cloudflare/skills
（Cloudflare 官方维护，Apache-2.0，README 明确支持 OpenAI Codex）

【安装目标】
~/.codex/skills/  —— Codex 的 skills 目录（参考 https://developers.openai.com/codex/skills/）
每个 skill 是一个目录，内含 SKILL.md（及可选辅助文件）。

【需要安装的 skills】（来自该仓库 skills/ 目录）
agents-sdk, cloudflare, cloudflare-email-service, cloudflare-one, cloudflare-one-migrations,
durable-objects, sandbox-sdk, turnstile-spin, web-perf, workers-best-practices, wrangler

【执行方式】（任选其一）
1. 若本机可用 npx：
   npx skills add https://github.com/cloudflare/skills
   （一次性安装仓库全部 skills，覆盖上面 11 个）
2. 或手动复制：
   git clone --depth 1 https://github.com/cloudflare/skills /tmp/cloudflare-skills
   然后把 /tmp/cloudflare-skills/skills/<名字>/ 整个目录复制到 ~/.codex/skills/<名字>/

【注意事项】
- 仓库 main 分支的 skills 列表可能已演进（例如 sandbox-sdk 可能已改名/拆分为
  sandbox-stable、sandbox-next；新增 building-mcp-server-on-cloudflare、
  building-ai-agent-on-cloudflare）。优先安装上面列的 11 个名字；
  若某个名字在仓库里不存在，安装当前仓库中的对应替代 skill，
  并在完成后明确告诉我"实际安装了哪些、哪些被替代/跳过"。
- 不要安装 commands/ 下的 slash 命令（那是 Claude Code 格式），只需要 skills/ 目录。

【完成后验证】
1. ls ~/.codex/skills/ 确认 11 个目录都在
2. 抽查每个目录内都有 SKILL.md
3. 把最终安装清单列给我
```

---

## 三、如果只想装常用的几个

```markdown
请从 https://github.com/cloudflare/skills 安装以下 skill 到 ~/.codex/skills/：
cloudflare、agents-sdk、durable-objects、wrangler、web-perf、cloudflare-one
（git clone --depth 1 后复制对应 skills/<名字>/ 目录，每个目录须含 SKILL.md，装完 ls 验证并汇报）
```
