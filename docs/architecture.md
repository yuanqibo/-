# 项目架构规范

## 标准技术栈

- 前端：Node.js 16.20.2、npm 8.19.4、Vue 3、TypeScript、Vite、Vue Router、Element Plus
- 后端：Java 17、Spring Boot 3、Spring Web、Spring JDBC
- 数据库：MySQL 8.4
- 身份与权限：ECP 前端 SDK 与 Java SDK

Vite 只负责前端开发和构建。业务规则、权限校验和持久化必须由 Java 服务负责，浏览器不能直接访问数据库，也不能把本地存储作为业务数据源。

Node.js 与 npm 版本由 `.nvmrc`、`.node-version`、`package.json`、根目录 `pom.xml` 和 `Dockerfile.build` 共同约束。修改版本时必须一次性同步这些文件，禁止不同构建入口使用不同运行时。

根目录 `pom.xml` 同时是 Maven 父工程和聚合工程。标准发布构建必须按“Vite 生成 `frontend-dist` → Spring Boot 复制静态资源 → JAR 打包 → 复制为根目录 `dist` 文件”的顺序执行，禁止让后端打包依赖工作区里上一次残留的前端产物。

## 前端分层

```text
src/
  core/                 应用级能力，例如登录上下文、路由和启动配置
  shared/               与业务无关的通用能力，例如 HTTP 客户端和基础组件
  features/<domain>/    按业务域组织的 API、composables、components 和页面
  views/                路由页面入口
```

业务界面使用 Vue 单文件组件和 Composition API。业务组件通过 `features/<domain>/api` 访问 Java API，通过 composable 管理页面状态；组件内不得散落 `fetch`，不得使用 HTML 字符串、`innerHTML`、`querySelector` 或全局 DOM 事件驱动业务交互。

当前实现状态：

- 所有 19 个菜单项均由 Vue SFC 或 ECP SDK 原生工作台承载，业务菜单不再指向通用旧入口。
- 业务域位于 `src/features/assets`、`approvals`、`dashboard`、`employees`、`organization` 和 `system-settings`。
- `src/portal/app.ts`、`PortalView`、`PortalShell` 及临时挂载桥已经删除。
- API 请求统一经过 `src/shared/api/http.ts`，ECP Bearer 会话在该层注入。
- ECP 账号管理 workspace 由 SDK 直接注册 `/workspace` 路由并作为完整页面渲染，不再经过本地页面壳或 iframe 桥接。
- `vue-tsc --noEmit` 同时校验 TypeScript 与 Vue 模板类型。

## 后端分层

```text
backend/src/main/java/team/acg/access/assets/
  <domain>/Controller    HTTP 参数、响应和权限入口
  <domain>/Service       业务规则与事务边界
  <domain>/Repository    Spring JDBC 和 MySQL 持久化
  approval/              ECP 审批发起、决策、回调幂等和状态校准
```

Controller 不直接实现持久化逻辑；Repository 不处理页面展示状态。所有写操作必须经过 Java 权限守卫、输入校验和领域服务。生产数据使用 MySQL，H2 只用于自动化测试。

审批域保持现有前端 API 契约：Java 以业务请求 `id` 作为 `bizNo`，调用 ECP `startByTemplate` 后保存 `approvalNo`；持有 `approvalNo` 的审批决策按该编号提交，启用集成前产生的存量单据继续按原流程完成。ECP 回调是状态同步触发器，不直接信任回调中的审批结果，而是持久化事件后重新查询平台详情。`APPROVED` 只在事务内执行一次现有资产命令，定时校准负责补偿遗漏回调。

## API 约定

- 前端统一使用 `src/shared/api/http.ts`，自动携带 ECP Bearer 会话。
- API 使用 `/api/<domain>` 路径，JSON 字段保持稳定的 TypeScript/Java 类型契约。
- 列表遵循现有 Java API 契约：目录类接口使用服务端查询和分页；资产与业务快照接口返回当前可见范围后，由 Vue composable 完成页面筛选和分页。迁移阶段不得为追求形式统一擅自改变这些契约。
- 非 2xx 响应由统一客户端转换为 `ApiError`，页面必须提供错误和重试状态。
- 权限以 Java 服务端判断为准，前端权限控制只用于交互展示。

## 迁移完成标准

一个业务域只有同时满足以下条件才算完成标准化：

1. 页面由 Vue SFC 渲染，不依赖 `innerHTML` 或 `querySelector` 驱动业务交互。
2. 请求集中在 feature API 层，页面没有散落的 `fetch`。
3. 查询、加载、错误、空数据和分页状态完整。
4. Java API 负责权限、校验和持久化，生产存储为 MySQL。
5. `npm run typecheck`、`npm run validate:authz`、`npm run build` 和 `npm run test:backend` 通过。
