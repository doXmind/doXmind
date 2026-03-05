# 部署到阿里云 ECS（中国区）

本文档说明 doXmind 后端在阿里云 ECS（中国香港）的部署流程。

## 服务器信息

| 项目         | 值                            |
| ------------ | ----------------------------- |
| **域名**     | `cn.api.doxmind.com`          |
| **公网 IP**  | `47.86.249.17`                |
| **实例规格** | ecs.c9i.large (2 vCPU, 4 GiB) |
| **操作系统** | Ubuntu 24.04 64位             |
| **区域**     | 中国香港 D                    |
| **SSH 用户** | `root`                        |
| **SSH Key**  | `~/.ssh/doxmind.pem`          |
| **工作目录** | `/opt/doxmind`                |

## SSH 连接

### 基本连接

```bash
ssh -i ~/.ssh/doxmind.pem root@47.86.249.17
```

### 带保活参数（推荐）

```bash
ssh -i ~/.ssh/doxmind.pem \
    -o ServerAliveInterval=30 \
    -o ServerAliveCountMax=10 \
    root@47.86.249.17
```

### SSH Config 配置（可选）

在 `~/.ssh/config` 中添加：

```
Host doxmind-cn
    HostName 47.86.249.17
    User root
    IdentityFile ~/.ssh/doxmind.pem
    ServerAliveInterval 30
    ServerAliveCountMax 10
```

然后可以直接使用：`ssh doxmind-cn`

## 服务器目录结构

```
/opt/doxmind/
├── .env.production          # 生产环境变量（敏感信息）
├── docker-compose.prod.yml  # Docker Compose 编排
├── server/                  # FastAPI 后端代码
│   ├── Dockerfile.prod      # 生产 Dockerfile（多阶段构建）
│   ├── api/                 # API 路由
│   ├── services/            # 业务逻辑
│   ├── middleware/           # 中间件（限流等）
│   ├── db/                  # 数据库模型
│   ├── alembic/             # 数据库迁移
│   └── ...
├── nginx/
│   ├── nginx.conf           # Nginx 主配置
│   └── conf.d/
│       └── api.conf         # 反向代理 + SSL 配置
├── scripts/                 # 运维脚本
└── backups/                 # 数据库备份
```

## Docker 服务

4 个容器协同工作：

| 容器               | 镜像                       | 端口        | 用途                     |
| ------------------ | -------------------------- | ----------- | ------------------------ |
| `doxmind-nginx`    | nginx:1.27-alpine          | 80, 443     | 反向代理 + SSL 终止      |
| `doxmind-backend`  | doxmind-backend (本地构建) | 8000 (内部) | FastAPI 后端 (4 workers) |
| `doxmind-postgres` | pgvector/pgvector:pg17     | 5432 (内部) | PostgreSQL + pgvector    |
| `doxmind-redis`    | redis:7-alpine             | 6379 (内部) | 限流存储                 |

## 手动部署流程

### 完整部署（更新代码 + 重建 + 重启）

```bash
# 1. 在本地打包 server 代码（排除开发文件）
cd /path/to/doxmind-mini
tar --exclude='__pycache__' \
    --exclude='*.pyc' \
    --exclude='.env' \
    --exclude='.pytest_cache' \
    --exclude='chroma_data' \
    --exclude='tests' \
    --exclude='*.db' \
    -czf /tmp/server-deploy.tar.gz server/

# 2. 上传到服务器
scp -i ~/.ssh/doxmind.pem /tmp/server-deploy.tar.gz root@47.86.249.17:/tmp/

# 3. 可选：同步 docker-compose 和 nginx 配置
scp -i ~/.ssh/doxmind.pem docker-compose.prod.yml root@47.86.249.17:/opt/doxmind/

# 4. SSH 到服务器执行部署
ssh -i ~/.ssh/doxmind.pem root@47.86.249.17 << 'DEPLOY'
cd /opt/doxmind

# 解压代码（覆盖旧版本）
tar -xzf /tmp/server-deploy.tar.gz && rm /tmp/server-deploy.tar.gz

# 保留旧镜像用于回滚
docker tag doxmind-backend:latest doxmind-backend:previous 2>/dev/null

# 重新构建后端镜像（--no-cache 确保依赖更新）
docker compose --env-file .env.production -f docker-compose.prod.yml build --no-cache backend

# 运行数据库迁移
docker compose --env-file .env.production -f docker-compose.prod.yml run --rm backend alembic upgrade head

# 重启后端（force-recreate 使用新镜像）
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --force-recreate backend

# 等待健康检查通过
echo "等待后端启动..."
sleep 10

# 验证
docker compose --env-file .env.production -f docker-compose.prod.yml ps
curl -s http://localhost/health

# 重载 Nginx
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T nginx nginx -s reload

# 清理旧镜像
docker image prune -f
DEPLOY
```

### 快速重启（不重建镜像）

```bash
ssh -i ~/.ssh/doxmind.pem root@47.86.249.17 << 'EOF'
cd /opt/doxmind
docker compose --env-file .env.production -f docker-compose.prod.yml restart backend
EOF
```

### 回滚到上一版本

```bash
ssh -i ~/.ssh/doxmind.pem root@47.86.249.17 << 'EOF'
cd /opt/doxmind
docker tag doxmind-backend:latest doxmind-backend:broken
docker tag doxmind-backend:previous doxmind-backend:latest
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --force-recreate backend
EOF
```

## 常用运维命令

### 检查服务状态

```bash
ssh -i ~/.ssh/doxmind.pem root@47.86.249.17 "cd /opt/doxmind && docker compose --env-file .env.production -f docker-compose.prod.yml ps"
```

### 查看后端日志

```bash
ssh -i ~/.ssh/doxmind.pem root@47.86.249.17 "cd /opt/doxmind && docker compose --env-file .env.production -f docker-compose.prod.yml logs --tail 100 backend"
```

### 实时跟踪日志

```bash
ssh -i ~/.ssh/doxmind.pem root@47.86.249.17 "cd /opt/doxmind && docker compose --env-file .env.production -f docker-compose.prod.yml logs -f backend"
```

### 查看所有容器资源使用

```bash
ssh -i ~/.ssh/doxmind.pem root@47.86.249.17 "docker stats --no-stream"
```

## 数据库操作

### 查看迁移版本

```bash
ssh -i ~/.ssh/doxmind.pem root@47.86.249.17 << 'EOF'
cd /opt/doxmind
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T postgres \
  psql -U doxmind -d doxmind -c "SELECT version_num FROM alembic_version;"
EOF
```

### 手动运行迁移

```bash
ssh -i ~/.ssh/doxmind.pem root@47.86.249.17 << 'EOF'
cd /opt/doxmind
docker compose --env-file .env.production -f docker-compose.prod.yml run --rm backend alembic upgrade head
EOF
```

### 连接到 PostgreSQL

```bash
ssh -i ~/.ssh/doxmind.pem root@47.86.249.17 << 'EOF'
cd /opt/doxmind
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T postgres \
  psql -U doxmind -d doxmind
EOF
```

### 执行 SQL 查询

```bash
ssh -i ~/.ssh/doxmind.pem root@47.86.249.17 << 'EOF'
cd /opt/doxmind
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T postgres \
  psql -U doxmind -d doxmind -c "SELECT COUNT(*) FROM users;"
EOF
```

## SSL 证书

使用 Let's Encrypt + Certbot：

```bash
# 首次申请证书
ssh -i ~/.ssh/doxmind.pem root@47.86.249.17 << 'EOF'
certbot certonly --webroot \
  -w /opt/doxmind/nginx/certbot-webroot \
  -d cn.api.doxmind.com \
  --non-interactive --agree-tos -m your-email@example.com
EOF

# 证书续期（建议配置 cron）
# 0 3 * * 1 certbot renew --quiet && docker exec doxmind-nginx nginx -s reload
```

证书路径：`/etc/letsencrypt/live/cn.api.doxmind.com/`

## 环境变量

生产环境变量存储在 `/opt/doxmind/.env.production`，包含：

- API Keys: `OPENROUTER_API_KEY`, `BRAVE_SEARCH_API_KEY`, `GOOGLE_API_KEY`
- File Storage: `STORAGE_BACKEND=local`, `LOCAL_STORAGE_PATH=/app/data/uploads`
- PostgreSQL: `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`
- JWT: `JWT_SECRET_KEY`, `JWT_ACCESS_TOKEN_EXPIRE_MINUTES`, `JWT_REFRESH_TOKEN_EXPIRE_DAYS`
- OAuth: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`
- SMTP: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`
- Cookie: `COOKIE_SECURE=true`, `COOKIE_SAMESITE=none`, `COOKIE_DOMAIN=`

查看当前配置：

```bash
ssh -i ~/.ssh/doxmind.pem root@47.86.249.17 "cat /opt/doxmind/.env.production"
```

## 架构说明

```
客户端
  │
  │ HTTPS (443)
  ▼
┌──────────────────────┐
│ Nginx (反向代理)       │  ← SSL 终止, 限流 (30r/s), 安全头
│ cn.api.doxmind.com   │
└──────────┬───────────┘
           │ HTTP (8000, 内部)
           ▼
┌──────────────────────┐
│ FastAPI Backend       │  ← 4 uvicorn workers, JWT 认证, 应用级限流
│ (doxmind-backend)     │
└──┬────────┬────────┬─┘
   │        │        │
   ▼        ▼        ▼
┌──────┐ ┌──────┐ ┌──────────────┐
│Postgr│ │Redis │ │ 本地磁盘      │
│eSQL  │ │(限流)│ │ (图片存储)    │
│+pgvec│ │      │ │ uploads_data │
└──────┘ └──────┘ └──────────────┘
```

## 与 AWS EC2（国际版）的区别

| 项目     | AWS EC2 (api.doxmind.com)     | 阿里云 ECS (cn.api.doxmind.com) |
| -------- | ----------------------------- | ------------------------------- |
| SSH 用户 | `ubuntu`                      | `root`                          |
| SSH Key  | `~/.ssh/doxmind-ec2-key.pem`  | `~/.ssh/doxmind.pem`            |
| 自动部署 | GitHub Actions (`deploy.yml`) | 手动 scp + ssh                  |
| 图片存储 | AWS S3 (us-east-1)            | 本地磁盘 (`uploads_data` 卷)    |
| 区域     | AWS (国际)                    | 阿里云中国香港                  |
| 用途     | 国际用户                      | 中国用户（低延迟）              |

## 已知限制与后续计划

### 图片存储：本地磁盘（临时方案）

CN 服务器目前使用本地磁盘存储图片（`STORAGE_BACKEND=local`），而非 AWS S3。

**当前状态：**

- 图片存储在 Docker 命名卷 `uploads_data` 中，路径 `/app/data/uploads/`
- 容器重启不会丢失数据（持久化卷）
- 60GB 系统盘，短期内足够使用

**限制：**

- 磁盘空间有限（60GB 系统盘需与 Docker 镜像、数据库共享）
- 无 CDN 加速，图片通过后端代理返回（user → backend → 本地文件 → backend → user）
- 服务器故障时图片数据无异地备份

**后续迁移方案（阿里云 OSS）：**

当用户量增长后，建议迁移到阿里云 OSS（中国香港），代码已预留 S3 兼容接口支持：

```bash
# 只需修改 .env.production 中的 3 个变量
STORAGE_BACKEND=s3
AWS_ACCESS_KEY_ID=<OSS AccessKey ID>
AWS_SECRET_ACCESS_KEY=<OSS AccessKey Secret>
AWS_S3_BUCKET=<OSS Bucket 名称>
AWS_S3_REGION=oss-cn-hongkong
```

> 注意：如果使用阿里云 OSS 的 S3 兼容接口，还需要在 `config.py` 中添加 `S3_ENDPOINT_URL` 配置项，
> 并在 `StorageService.__init__` 中传入 `endpoint_url` 参数。

### CI/CD：手动部署

目前 CN 服务器没有自动部署流水线（AWS EC2 使用 GitHub Actions）。每次更新需手动执行 tar + scp + ssh 流程。

后续可考虑：

- 配置 GitHub Actions 双目标部署（同时推送到 AWS 和阿里云）
- 或在阿里云 CodePipeline 中配置独立流水线

## 常见问题

### 1. 连接超时

检查阿里云安全组规则，确保入站规则允许：

- TCP 22（SSH）
- TCP 80（HTTP）
- TCP 443（HTTPS）

### 2. Docker 构建缓慢

阿里云 ECS 拉取 PyPI 包可能较慢，可以考虑配置镜像源：

```dockerfile
# 在 Dockerfile.prod 中添加
RUN pip config set global.index-url https://mirrors.aliyun.com/pypi/simple/
```

### 3. 磁盘空间不足

```bash
# 查看磁盘使用
df -h
docker system df

# 查看图片存储占用
docker exec doxmind-backend du -sh /app/data/uploads/

# 清理 Docker 缓存（注意：不要加 --volumes，会删除上传的图片和数据库数据）
docker system prune -a
```

## 相关文档

- [SSH-CONNECTION.md](SSH-CONNECTION.md) - AWS EC2 连接文档
- [docker-compose.prod.yml](../docker-compose.prod.yml) - Docker Compose 配置
- [Dockerfile.prod](../server/Dockerfile.prod) - 后端 Dockerfile
- [nginx/conf.d/api.conf](../nginx/conf.d/api.conf) - Nginx 配置
- [CLAUDE.md](../CLAUDE.md) - 项目整体文档
