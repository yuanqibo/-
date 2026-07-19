# Asset Platform

企业资产管理平台，采用 Vue 3 + Vite 前端和 Spring Boot Java 后端。Java 服务负责 ECP 身份与权限、资产生命周期命令、审批、盘点、耗材、维修、合同、配置校验和数据持久化；前端负责页面展示与交互。

## 环境要求

- Node.js 22.14.0、npm 10.9.2（本地、Maven 与 Docker 前端构建统一版本）
- Java 17
- Maven 3.9
- MySQL 8.4（生产环境）

公司 ECP 前端与 Java SDK 制品保存在 `vendor/`，构建时不依赖浏览器登录态或外部 Nexus 凭据。

仓库根目录的 `pom.xml` 用于公司 GitLab Maven 发布模板，并在 Maven `package` 阶段生成前端 `dist/` 与 `backend/target/access-assets-server-1.0.0.jar`。后端工程位于 `backend/pom.xml`，生产 Dockerfile 使用公司 Java 17 运行镜像加载该 jar。

GitLab 项目变量需要与公司 Maven 模板匹配：

```text
JDK_VERSION=17.0.10
ARTIFACT_PATH=backend/target/access-assets-server-1.0.0.jar
```

如果 Runner 仍固定为 JDK 8，Spring Boot 3 / Java 17 后端无法在 Maven 阶段编译。

## 本地运行

```bash
nvm use
npm ci
npm run build:all
npm run start:dev
```

访问 [http://127.0.0.1:5387](http://127.0.0.1:5387)。`start:dev` 与生产环境一样启用 ECP，并要求从环境变量提供 ECP 密钥；启动前还需配置可访问的 MySQL 数据库。仅自动化测试可使用显式的 `ALLOW_UNAUTHENTICATED_TEST_MODE=true`，该模式不得用于共享环境。

单独运行前端开发服务器：

```bash
npm run dev
```

## 验证

首次运行 Playwright 前安装项目锁定版本对应的 Chromium：

```bash
npx playwright install chromium
```

完整质量验收命令：

```bash
npm run typecheck
npm run validate:authz
npm run build
npm run test:unit
npm run test:e2e
npm run test:backend
```

`npm run test:frontend` 会依次执行 Vitest 单元测试和 Playwright 桌面端、移动端回归测试。

## 生产配置

复制 `.env.example` 并通过部署系统注入实际密钥。生产环境必须启用 ECP SDK：

```text
ECP_SDK_ENABLED=true
ECP_APP_SECRET=...
ECP_SDK_PERMISSION_ENABLED=false
ASSET_PORTAL_SYSTEM_CONFIG_ENCRYPTION_KEY=...
DATABASE_URL=jdbc:mysql://127.0.0.1:3306/asset_portal?useUnicode=true&characterEncoding=utf8&serverTimezone=Asia/Shanghai
DATABASE_USER=asset_portal
DATABASE_PASSWORD=...
```

`ASSET_PORTAL_SYSTEM_CONFIG_ENCRYPTION_KEY` 用于 Java 后端加密系统对接凭据，必须是 Base64 编码的 32 字节随机值。首次部署可用 `openssl rand -base64 32` 生成，后续必须保持不变并通过密钥管理系统注入，不能提交到 Git。

`ECP_TENANT_ID` 是可选租户白名单；配置后 Java 会拒绝其他租户的有效令牌，不配置则按 ECP 会话本身解析用户与权限。`ECP_SDK_PERMISSION_SNAPSHOT_SIGNING_SECRET` 只在显式开启 `ECP_SDK_PERMISSION_ENABLED=true`、需要 SDK 签名快照权限切面时提供。默认生产模式使用 Java 后端基于 ECP session context 的 Bearer 权限守卫。

直接启动：

```bash
npm run build:all
java -jar backend/target/access-assets-server-1.0.0.jar
```

健康检查：

```text
GET /actuator/health
```

## Docker

```bash
docker compose up -d --build
```

Compose 会创建 MySQL 8 数据库 `asset_portal`，数据保存在 `mysql-data` 卷中；Java 服务会在首次启动时自动创建业务表。生产部署必须覆盖示例数据库密码，并由环境变量或密钥管理系统提供数据库与 ECP 凭据。

## 目录

```text
backend/                 Spring Boot 服务、领域命令和测试
src/                     Vue 前端
authz/                   ECP 菜单、角色、权限和功能清单
public/assets/           页面使用的图片与导入模板
vendor/ecp-sdk/          ECP 前端 npm 制品
vendor/ecp-sdk-java/     ECP Java Maven 制品
scripts/                 SDK 安装、部署和更新脚本
```

前端按 `core/shared/features/views` 分层，所有业务路由由 Vue Router / ECP 菜单直接加载 Vue SFC。业务域请求集中在各自 `features/<domain>/api`，并统一经过 `src/shared/api/http.ts`；页面状态由 Composition API composable 管理。详细边界与 API 约定见 [项目架构规范](docs/architecture.md)。

Vue 标准化迁移已完成。首页、资产、入库、领用退库、借用归还、盘点、资产设置、审批、员工信息、组织架构、成员授权、员工自助、系统对接和表单管理均已迁移到 Vue SFC。资产导入、目录工作簿、批量操作、打印、盘点更新和员工自助签字配置也由 Vue/Element Plus 承载。历史 `src/portal/app.ts`、`PortalView`、`PortalShell` 和临时挂载桥已删除，不再保留原生 DOM 业务实现。

生产构建按 Vue、Element Plus、ECP SDK 和业务路由拆分。ECP 成员授权工作台自带的预构建 Web Component 仅在 `/workspace` 被访问时延迟加载，不进入普通业务页面的首屏包。

## 权限边界

- 生产身份与管理角色由 Java 根据 ECP 会话解析。
- Java 业务接口在 ECP 未启用时默认拒绝访问，不再以本地账号或环境变量授予管理员权限。
- 资产新增、导入、领用、退库、借用、归还、交接、编辑、删除及履历由 Java 命令执行。
- 用户和角色配置要求 `authz:app_role:assign`。
- 分类、位置、耗材、维修、合同及业务设置使用各自的细粒度 ECP 权限码。
- 资产日常写入只开放领域命令接口，不提供客户端整表覆盖接口。

## 部署脚本

首次安装 systemd 服务：

```bash
DATABASE_PASSWORD='...' \
ECP_APP_SECRET='...' \
ASSET_PORTAL_SYSTEM_CONFIG_ENCRYPTION_KEY='...' \
bash scripts/setup-server.sh
```

从 Git 更新：

```bash
APP_DIR=/opt/asset-portal bash scripts/update-from-git.sh
```
