# 项目架构规范

## 标准技术栈

- 前端：Node.js 22.14.0、npm 10.9.2、Vue 3、TypeScript、Vite、Vue Router、Element Plus
- 后端：Java 17、Spring Boot 3、Spring Web、Spring JDBC
- 数据库：MySQL 8.4
- 身份与权限：ECP 前端 SDK 与 Java SDK

Vite 只负责前端开发和构建。业务规则、权限校验和持久化必须由 Java 服务负责，浏览器不能直接访问数据库，也不能把本地存储作为业务数据源。

Node.js 与 npm 版本由 `.nvmrc`、`.node-version`、`package.json`、根目录 `pom.xml` 和 `Dockerfile.build` 共同约束。修改版本时必须一次性同步这些文件，禁止不同构建入口使用不同运行时。

根目录 `pom.xml` 同时是 Maven 父工程和聚合工程。标准发布构建必须按“Vite 生成 `dist` → Spring Boot 复制静态资源 → JAR 打包”的顺序执行，禁止让后端打包依赖工作区里上一次残留的 `dist`。

## 前端分层

```text
src/
  core/                 应用级能力，例如登录上下文、路由和启动配置
  shared/               与业务无关的通用能力，例如 HTTP 客户端和基础组件
  features/<domain>/    按业务域组织的 API、composables、components 和页面
  views/                路由页面入口
  portal/               尚未迁移的历史业务页面
```

新增业务界面必须使用 Vue 单文件组件和 Composition API。业务组件通过 `features/<domain>/api` 访问 Java API，通过 composable 管理页面状态；不得在 `app.ts` 中新增 HTML 字符串、全局事件绑定或业务请求。

`src/portal/app.ts` 是历史实现，只允许为迁移删除代码，不再新增挂载适配器。每完成一个业务域迁移，应同时删除该业务域在旧文件里的渲染、事件、状态和临时桥接代码。

当前迁移状态：

- `员工信息` 与 `组织架构` 已完成业务域迁移，目录分别位于 `src/features/employees/` 和 `src/features/organization/`。
- 路由 `/system/employees` 与 `/system/departments` 由 Vue Router 直接加载对应 Vue SFC。
- 员工目录与组织架构请求集中在各自 feature API 层，并统一经过 `src/shared/api/http.ts`。
- 其余业务域仍由历史入口承载；全部迁移完成后删除 `src/portal/app.ts`。

## 后端分层

```text
backend/src/main/java/team/acg/access/assets/
  <domain>/Controller    HTTP 参数、响应和权限入口
  <domain>/Service       业务规则与事务边界
  <domain>/Repository    Spring JDBC 和 MySQL 持久化
```

Controller 不直接实现持久化逻辑；Repository 不处理页面展示状态。所有写操作必须经过 Java 权限守卫、输入校验和领域服务。生产数据使用 MySQL，H2 只用于自动化测试。

## API 约定

- 前端统一使用 `src/shared/api/http.ts`，自动携带 ECP Bearer 会话。
- API 使用 `/api/<domain>` 路径，JSON 字段保持稳定的 TypeScript/Java 类型契约。
- 列表接口必须支持服务端查询和分页，不把全部数据下载到浏览器后筛选。
- 非 2xx 响应由统一客户端转换为 `ApiError`，页面必须提供错误和重试状态。
- 权限以 Java 服务端判断为准，前端权限控制只用于交互展示。

## 迁移完成标准

一个业务域只有同时满足以下条件才算完成标准化：

1. 页面由 Vue SFC 渲染，不依赖 `innerHTML` 或 `querySelector` 驱动业务交互。
2. 请求集中在 feature API 层，页面没有散落的 `fetch`。
3. 查询、加载、错误、空数据和分页状态完整。
4. Java API 负责权限、校验和持久化，生产存储为 MySQL。
5. `npm run typecheck`、`npm run validate:authz`、`npm run build` 和 `npm run test:backend` 通过。
