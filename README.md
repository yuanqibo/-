# access-assets-portal

资产管理系统前端体验原型。

接手前建议先阅读 [DESIGN.md](./DESIGN.md)，里面说明了产品定位、权限/OIDC/审批设计原则，以及后续迭代方向。

当前版本包含轻量 Node 后端和共享存储。浏览器仍保留本地缓存，但资产、标签模板、打印配置、分类、位置、角色和本地用户等关键数据会同步到服务器数据库，同一局域网访问同一个服务地址时会共用这些数据。服务器可使用 MySQL，也可不配置数据库时回退到本地 SQLite。

- `assets`: 资产台账
- `requests`: 员工申请与外部审批状态
- `stocktakes`: 盘点任务
- `consumables`: 耗材库存

当前新增了一层登录入口演示：

- 先登录，再进入角色对应工作台
- 支持本地账号演示不同角色
- 支持 OIDC 已绑定身份直接登录
- 支持待处理身份进入“绑定/自动新增”确认流程
- 登录后菜单、首页动作、资产操作会跟随本地角色变化

## 本地启动

```bash
cd /Users/access/Documents/Playground/access-assets/access-assets-portal
HOST=0.0.0.0 PORT=5387 node server.mjs
```

访问：

```text
http://127.0.0.1:5387/
http://你的局域网IP:5387/
```

未配置 MySQL 时，共享数据库默认位置：

```text
data/app.db
```

可通过环境变量指定：

```bash
DB_PATH=/opt/asset-portal/data/app.db HOST=0.0.0.0 PORT=5387 node server.mjs
```

## Ubuntu 局域网部署

建议使用 Node.js 22 或更高版本。生产或多人访问建议使用 MySQL。

```bash
sudo apt update
sudo apt install -y curl
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v
```

把项目放到服务器，例如：

```bash
sudo mkdir -p /opt/asset-portal
sudo chown -R $USER:$USER /opt/asset-portal
```

复制项目文件到 `/opt/asset-portal` 后安装依赖：

```bash
cd /opt/asset-portal
npm install --omit=dev
```

### 使用 MySQL

安装 MySQL 并创建库和账号：

```bash
sudo apt install -y mysql-server
sudo mysql
```

在 MySQL 命令行里执行：

```sql
CREATE DATABASE IF NOT EXISTS asset_portal CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'asset_portal'@'localhost' IDENTIFIED BY '请换成一个强密码';
GRANT ALL PRIVILEGES ON asset_portal.* TO 'asset_portal'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

启动服务：

```bash
cd /opt/asset-portal
HOST=0.0.0.0 PORT=5387 \
DB_DRIVER=mysql \
MYSQL_HOST=127.0.0.1 \
MYSQL_PORT=3306 \
MYSQL_USER=asset_portal \
MYSQL_PASSWORD='请换成一个强密码' \
MYSQL_DATABASE=asset_portal \
node server.mjs
```

其他电脑访问：

```text
http://服务器IP:5387/
```

如果原来的资产只存在某个旧浏览器里，首次切到服务器数据库后，需要在那个旧浏览器打开同一个服务器地址，并在控制台执行一次：

```js
assetPortalSyncLocalData()
```

返回 `true` 后，其他浏览器刷新即可读取同一份服务器数据。

### 一键更新部署

首次在服务器上装好 MySQL、上传过项目文件后，可以安装 systemd 服务：

```bash
cd /opt/asset-portal
MYSQL_PASSWORD='请换成你的 MySQL 密码' bash scripts/setup-server.sh
sudo systemctl restart asset-portal
```

### Git 拉取更新

项目接入 Git 远程仓库后，服务器建议直接从仓库拉取代码：

```bash
sudo mkdir -p /opt/asset-portal
sudo chown -R $USER:$USER /opt/asset-portal
git clone <你的Git仓库地址> /opt/asset-portal
cd /opt/asset-portal
npm install --omit=dev
MYSQL_PASSWORD='请换成你的 MySQL 密码' bash scripts/setup-server.sh
sudo systemctl restart asset-portal
```

之后每次本地改完并推送到仓库，服务器只需要执行：

```bash
cd /opt/asset-portal
git pull --ff-only
npm install --omit=dev
sudo systemctl restart asset-portal
```

也可以直接执行仓库里的更新脚本：

```bash
APP_DIR=/opt/asset-portal bash scripts/update-from-git.sh
```

`data/`、`node_modules/`、日志、`.env` 不会进入 Git 仓库，服务器上的数据库和环境变量不会被覆盖。

### rsync 备选更新

之后每次在 Mac 本地改完代码，只需要执行：

```bash
cd /Users/access/Documents/Playground/access-assets/access-assets-portal
scripts/deploy.sh 服务器IP
```

脚本会自动同步文件、安装依赖并重启服务。数据库、`node_modules`、日志文件不会被同步覆盖。

## 飞书应用内测试

当前项目是纯静态网页，可以先作为飞书“网页应用”接入工作台测试 UI 和交互。

1. 启动本地服务：

```bash
python3 -m http.server 5387
```

2. 暴露 HTTPS 测试地址：

```bash
ngrok http 5387
```

3. 复制 ngrok 输出的 `https://...ngrok-free.dev` 地址。

4. 登录飞书开放平台，创建企业自建应用，添加“网页应用”能力。

5. 在“应用能力 / 网页应用”中，将桌面端主页和移动端主页配置为上一步的 HTTPS 地址。

6. 将应用加入测试范围或发布到企业内后，在飞书客户端工作台打开测试。

注意：ngrok 地址只适合临时测试。后续正式测试建议部署到稳定 HTTPS 域名。

## 飞书 OAuth / 免登后端

项目已包含一个轻量 Node 后端 `server.mjs`，用于飞书 OAuth 授权、回调换 token、读取用户信息和维护本地登录态。

1. 复制环境变量示例：

```bash
cp .env.example .env
```

2. 填写飞书应用信息：

```bash
export PORT=5387
export PUBLIC_BASE_URL=https://你的-ngrok-或正式域名
export FEISHU_APP_ID=cli_xxxxxxxxxxxxx
export FEISHU_APP_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

3. 启动后端和静态页面：

```bash
node server.mjs
```

4. 飞书开放平台配置：

```text
网页应用主页：https://你的-ngrok-或正式域名/
OAuth 重定向 URL：https://你的-ngrok-或正式域名/api/auth/feishu/callback
```

5. 前端登录入口：

```text
/api/auth/feishu/login
```

登录成功后，前端会调用 `/api/auth/me` 读取后端 session，并按飞书用户信息映射为系统内的普通管理员或普通员工。当前示例规则是：邮箱包含 `admin` 时映射普通管理员，否则映射普通员工；正式版本应改为读取后端角色表。

## 已实现体验

- 数据中控首页
- 资产台账列表
- 资产分类、标签筛选、状态/位置/风险筛选
- 登录入口与身份绑定确认流程
- 登录账号决定角色，管理员支持免审批直办，普通员工默认发起外部审批
- 支持 OIDC 身份源配置、Claim 映射、本地用户自动新增/绑定和待处理身份队列
- 资产详情抽屉与生命周期履历
- 申请审批列表与审批轨迹
- 盘点任务、故障维修、耗材库存、合同供应商
- 新建/申请类模拟弹窗
- 全局搜索、局部查询、侧边栏折叠、响应式布局
