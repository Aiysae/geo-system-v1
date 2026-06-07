# geo-strategy-system · 阿里云 ECS 部署指南

从 Vercel 迁移到阿里云自托管。代码仓库：[geo-system-v1](https://github.com/Aiysae/geo-system-v1.git)

---

## 环境信息（部署前填写）

| 项 | 你的值 |
|----|--------|
| 生产域名 | `________________` |
| ECS 公网 IP | `________________` |
| SSH 用户 | `root` / `ubuntu` |
| SSH 端口 | `22` |
| 服务器部署根目录 | `/var/www/geo-strategy-system` |
| Node 版本 | `20` LTS 推荐 |

---

## 架构说明

| 组件 | 说明 |
|------|------|
| 运行方式 | `npm run build` + `pm2` + `next start`（端口 3000） |
| 反向代理 | Nginx → HTTPS → `127.0.0.1:3000` |
| 登录 | 自建邮箱密码账号 + HttpOnly Session |
| 积分 / 充值 | `@vercel/kv`（Upstash），复制 `KV_*` 环境变量即可，**无需改代码** |
| AI | DeepSeek / 豆包 / 千问 / Kimi |

---

## 一、ECS 前置条件

1. **规格**：建议 ≥ 2 核 4 GB（渗透率检测会并发调多个模型）
2. **系统**：Ubuntu 22.04 / 24.04
3. **安全组**：放行 **22、80、443**；**不要**对公网开放 3000
4. **域名 DNS**：在阿里云 DNS 添加 **A 记录**，主机记录 `@`（及可选 `www`）指向 ECS 公网 IP

> 若域名此前绑在 Vercel：迁移完成后在 Vercel 移除该域名，避免与阿里云冲突。

---

## 二、服务器首次安装

SSH 登录 ECS 后执行：

```bash
sudo apt update && sudo apt upgrade -y
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs git nginx certbot python3-certbot-nginx
sudo npm install -g pm2
node -v   # 应 >= v20
```

---

## 三、拉取代码

```bash
sudo mkdir -p /var/www/geo-strategy-system
sudo chown "$USER:$USER" /var/www/geo-strategy-system
cd /var/www/geo-strategy-system

git clone https://github.com/Aiysae/geo-system-v1.git .
# 若目录非空，可改为：git pull origin main
```

项目 Next.js 应用在子目录 `geo-strategy-system/`。

---

## 四、配置环境变量

### 4.1 从 Vercel 导出

1. 打开 [Vercel Dashboard](https://vercel.com) → 项目 → **Settings → Environment Variables**
2. 复制 **Production** 下全部变量

### 4.2 在服务器创建文件

```bash
cp geo-strategy-system/.env.production.example /var/www/geo-strategy-system/.env.production
nano /var/www/geo-strategy-system/.env.production
```

按 `.env.production.example` 中的项填入真实值。`AUTH_SECRET` 可用 `openssl rand -base64 32` 生成；`ADMIN_EMAILS` 填写管理员邮箱，多个用英文逗号分隔。

```bash
chmod 600 /var/www/geo-strategy-system/.env.production
```

**切勿**将 `.env.production` 提交到 Git。

---

## 五、构建与启动

```bash
cd /var/www/geo-strategy-system/geo-strategy-system

set -a && source ../.env.production && set +a
npm ci
npm run build

pm2 start ecosystem.config.cjs
pm2 save
pm2 startup   # 按提示执行生成的 sudo 命令，实现开机自启
```

常用命令：

```bash
pm2 status
pm2 logs geo-system --lines 100
pm2 restart geo-system --update-env
```

---

## 六、Nginx + HTTPS

```bash
cd /var/www/geo-strategy-system/geo-strategy-system
sudo cp deploy/nginx/geo.conf.example /etc/nginx/sites-available/geo
sudo nano /etc/nginx/sites-available/geo
# 将 your-domain.com 改为你的真实域名

sudo ln -sf /etc/nginx/sites-available/geo /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default   # 如有冲突可删默认站
sudo nginx -t
sudo systemctl reload nginx

sudo certbot --nginx -d your-domain.com -d www.your-domain.com
```

验证：`curl -I https://your-domain.com` 应返回 200/307。

---

## 七、账号与后台配置

1. 在服务器 `.env.production` 写入 `AUTH_SECRET` 和 `ADMIN_EMAILS`
2. 执行 `set -a && source ../.env.production && set +a && npm run build`
3. 执行 `pm2 restart geo-system --update-env`
4. 用 `ADMIN_EMAILS` 中的邮箱注册或登录
5. 访问 `/admin` 管理用户与积分，访问 `/admin/recharge` 审批充值申请

---

## 八、上线验证清单

在浏览器逐项确认：

- [ ] `https://你的域名` 首页可访问
- [ ] 邮箱密码登录 / 注册正常
- [ ] 管理员邮箱可访问 `/admin`
- [ ] 登录后积分余额能显示（KV 连通）
- [ ] **模块一** 渗透率检测能跑完（可能需 1–3 分钟）
- [ ] **模块二** AI 诊断有结果
- [ ] **模块三** GEO 策略生成有结果
- [ ] 充值审批（管理员）正常

服务端日志：

```bash
pm2 logs geo-system --lines 100
```

---

## 九、日常更新发布

### 手动

```bash
cd /var/www/geo-strategy-system
git pull origin main
cd geo-strategy-system
set -a && source ../.env.production && set +a
npm ci
npm run build
pm2 restart geo-system --update-env
```

### GitHub Actions 自动部署（可选）

在 GitHub 仓库 **Settings → Secrets and variables → Actions** 添加：

| Secret | 说明 |
|--------|------|
| `ECS_HOST` | ECS 公网 IP |
| `ECS_USER` | SSH 用户名 |
| `ECS_SSH_KEY` | SSH 私钥全文 |
| `ECS_SSH_PORT` | 可选，默认 22 |
| `DEPLOY_PATH` | 可选，默认 `/var/www/geo-strategy-system` |

推送 `main` 分支且 `geo-strategy-system/**` 有变更时，工作流 `.github/workflows/deploy-geo.yml` 会自动部署。

---

## 十、从 Vercel 下线

确认阿里云访问正常后：

1. Vercel → 项目 → **Settings → Domains** → 移除自定义域名
2. 可选：**Pause** 部署，避免双环境同时运行

---

## 十一、故障排查

### AI 调用无返回 / 一直 loading

1. 检查 `.env.production` 是否包含全部 LLM Key（`DEEPSEEK_*`、`ARK_*`、`DASHSCOPE_*`、`MOONSHOT_*`）
2. `pm2 logs geo-system` 搜索 `API Key 未配置`、`HTTP 401`、`402`、`429`
3. Nginx 是否超时：渗透率需 `proxy_read_timeout 300s`（见 `deploy/nginx/geo.conf.example`）
4. 修改环境变量后执行：`pm2 restart geo-system --update-env`

### 401 Unauthorized

- 未登录或 Session 配置异常：检查 `AUTH_SECRET` 是否存在，修改后执行 `pm2 restart geo-system --update-env`

### 403 Insufficient credits

- 积分不足；检查 `KV_REST_API_*` 是否正确，用户 ID 是否正常

### KV / Redis 连接失败

- 确认 `KV_REST_API_URL`、`KV_REST_API_TOKEN` 与 Vercel 上一致
- 阿里云安全组一般无需为 Upstash 单独开端口（HTTPS 出站即可）

### 构建失败

```bash
cd geo-strategy-system
set -a && source ../.env.production && set +a
npm run build
```

根据报错修复；常见原因：Node 版本过低、缺少 `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`。

### 构建时 `Failed to fetch Geist from Google Fonts`

项目使用 `next/font/google` 拉取 Geist 字体，构建阶段需能访问 `fonts.googleapis.com`。若 ECS 在国内无法访问：

- 为服务器配置可访问 Google 的出站网络，或
- 在能访问外网的机器上 `npm run build` 后把 `.next` 目录同步到服务器（不推荐长期做法）

---

## 十二、仓库内部署相关文件

| 文件 | 用途 |
|------|------|
| `.env.production.example` | 环境变量模板 |
| `ecosystem.config.cjs` | PM2 进程配置 |
| `deploy/nginx/geo.conf.example` | Nginx 配置示例 |
| `../.github/workflows/deploy-geo.yml` | GitHub Actions 自动部署 |
