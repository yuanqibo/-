# Asset Platform

企业资产管理平台，采用 Vue 3 + Vite 前端和 Spring Boot Java 后端。Java 服务负责 ECP 身份与权限、资产生命周期命令、审批、盘点、耗材、维修、合同、配置校验、审计和数据持久化；前端负责页面展示与交互。

## 环境要求

- Node.js 22
- Java 21
- Maven 3.9
- MySQL 8（生产环境）

公司 ECP 前端与 Java SDK 制品保存在 `vendor/`，构建时不依赖浏览器登录态或外部 Nexus 凭据。

## 本地运行

```bash
npm ci
npm run build:all
npm run start:dev
```

访问 [http://127.0.0.1:5387](http://127.0.0.1:5387)。`start:dev` 会关闭 ECP 服务端鉴权，仅用于本地开发，并使用 `data/app-store.mv.db` 文件数据库。

单独运行前端开发服务器：

```bash
npm run dev
```

## 验证

```bash
npm run typecheck
npm run validate:authz
npm run build
npm run test:backend
```

## 生产配置

复制 `.env.example` 并通过部署系统注入实际密钥。生产环境必须启用 ECP SDK：

```text
ECP_SDK_ENABLED=true
ECP_APP_SECRET=...
ECP_SDK_PERMISSION_SNAPSHOT_SIGNING_SECRET=...
DATABASE_URL=jdbc:mysql://127.0.0.1:3306/asset_portal?useUnicode=true&characterEncoding=utf8&serverTimezone=Asia/Shanghai
DATABASE_USER=asset_portal
DATABASE_PASSWORD=...
```

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

生产部署不得使用 `docker-compose.yaml` 中的空密钥默认值，应由环境变量或密钥管理系统提供数据库与 ECP 凭据。

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

## 权限边界

- 生产身份与管理角色由 Java 根据 ECP 会话解析。
- 资产新增、导入、领用、退库、借用、归还、交接、编辑、删除及履历由 Java 命令执行。
- 用户和角色配置要求 `authz:app_role:assign`。
- 分类、位置及业务设置要求 `asset:update`。
- 资产日常写入只开放领域命令接口，不提供客户端整表覆盖接口。

## 部署脚本

首次安装 systemd 服务：

```bash
DATABASE_PASSWORD='...' \
ECP_APP_SECRET='...' \
ECP_SDK_PERMISSION_SNAPSHOT_SIGNING_SECRET='...' \
bash scripts/setup-server.sh
```

从 Git 更新：

```bash
APP_DIR=/opt/asset-portal bash scripts/update-from-git.sh
```
