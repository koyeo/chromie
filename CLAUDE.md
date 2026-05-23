# chromie

pnpm monorepo. Workspaces: `apps/*`, `packages/*`.

## 强制约束 (Hard rules)

### 1. shadcn/ui 只能经由 `packages/ui` 暴露

- shadcn/ui 组件 (`components.json`、`shadcn add` 生成的 primitives、Radix wrapper 等) **只能**存在于 `packages/ui` 内。
- 任何 `apps/*` 或其他 `packages/*` 想用 shadcn 组件,必须从 `@chromie/ui` 导入 (例如 `import { Button } from "@chromie/ui"`),不得直接 `pnpm add @radix-ui/react-*` 或在自己包里运行 `shadcn add`。
- 新增 / 升级 shadcn primitive 的流程: 在 `packages/ui` 内 `pnpm dlx shadcn@latest add <name>` → 在 `packages/ui/src/index.ts` 导出 → 在使用方 `import` 即可。
- `packages/ui` 同时拥有这套组件的 Tailwind 样式入口 (`src/styles.css`),消费方负责把它 `@import` 进自己的全局样式。

### 2. UUID 一律用 uuid v7,统一走 `uuidv7` 包

- 全仓库**禁止**使用 `crypto.randomUUID()` (v4)、`uuid` 包的 `v1/v3/v4/v5`、或任何自造的 ID 生成器。
- 唯一允许的 UUID 实现是 `uuidv7` 包 (`import { uuidv7 } from "uuidv7"`)。
- 当未来引入 DB / better-auth 时,better-auth 的 `advanced.database.generateId` 必须配置为 `uuidv7`,DB schema 中所有主键 / 外键 ID 列都使用 uuid v7 字符串。
- 任何新增表的 `id` 字段、任何业务实体的 ID,都走同一个工具函数 (推荐封装为 `newId()`),不要在调用点直接 `uuidv7()` 散落各处。

## 包与目录

- `apps/web` — Next.js 应用 (port 8948)。消费 `@chromie/ui`。(尚未创建)
- `packages/ui` — React + Tailwind v4 + shadcn/ui 封装层。(尚未创建)
- `packages/cli` — `chromie` CLI,1:1 透出 `chrome-devtools-mcp` 的全部工具 (`chromie devtools <tool> ...`)。基于 in-process MCP server + InMemoryTransport 实现,不依赖上游 daemon。

## 常用命令

- `pnpm install` — 安装全部 workspace 依赖
- `pnpm dev` — 启动开发栈 (iTerm panes,macOS only)
- `pnpm dev:parallel` — 并行启动所有 dev script (非 macOS 退路)
- `pnpm --filter @chromie/web dev` — 单独启动 Next.js
- `pnpm -r build` — 全量构建
- `pnpm -r typecheck` — 全量类型检查
- `pnpm chromie devtools <tool> [args]` — 调度 chrome-devtools-mcp 工具

## 端口

`apps/web` 钉死在 **8948**。要改三处同步: `apps/web/package.json` 的 `-p`、`.panes/dev.yaml` 里如有 `waitPort`、未来 `.env.local` 里如有 `BETTER_AUTH_URL`。
