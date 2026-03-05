# SSH 连接到 EC2 生产环境

本文档说明如何正确连接到 doXmind 生产环境的 EC2 服务器。

## 连接信息

- **域名**: `api.doxmind.com`
- **用户**: `ubuntu`
- **SSH Key**: `~/.ssh/doxmind-ec2-key.pem`
- **工作目录**: `/opt/doxmind`

## 连接方式

### 基本连接

```bash
ssh -i ~/.ssh/doxmind-ec2-key.pem ubuntu@api.doxmind.com
```

### 带保活参数的连接（推荐）

防止长时间运行任务时连接断开：

```bash
ssh -i ~/.ssh/doxmind-ec2-key.pem \
    -o ServerAliveInterval=30 \
    -o ServerAliveCountMax=10 \
    ubuntu@api.doxmind.com
```

### 执行单个命令

```bash
ssh -i ~/.ssh/doxmind-ec2-key.pem ubuntu@api.doxmind.com "cd /opt/doxmind && docker ps"
```

### 执行多个命令（使用 heredoc）

```bash
ssh -i ~/.ssh/doxmind-ec2-key.pem ubuntu@api.doxmind.com << 'EOF'
cd /opt/doxmind
docker compose --env-file .env.production -f docker-compose.prod.yml ps
docker compose --env-file .env.production -f docker-compose.prod.yml logs --tail 50 backend
EOF
```

## 常用操作

### 检查服务状态

```bash
ssh -i ~/.ssh/doxmind-ec2-key.pem ubuntu@api.doxmind.com << 'EOF'
cd /opt/doxmind
docker compose --env-file .env.production -f docker-compose.prod.yml ps
EOF
```

### 查看后端日志

```bash
ssh -i ~/.ssh/doxmind-ec2-key.pem ubuntu@api.doxmind.com << 'EOF'
cd /opt/doxmind
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f backend
EOF
```

### 检查数据库迁移版本

```bash
ssh -i ~/.ssh/doxmind-ec2-key.pem ubuntu@api.doxmind.com << 'EOF'
cd /opt/doxmind
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T postgres \
  psql -U doxmind -d doxmind -c "SELECT version_num FROM alembic_version;"
EOF
```

### 手动运行数据库迁移

```bash
ssh -i ~/.ssh/doxmind-ec2-key.pem ubuntu@api.doxmind.com << 'EOF'
cd /opt/doxmind
docker compose --env-file .env.production -f docker-compose.prod.yml run --rm backend alembic upgrade head
EOF
```

### 重启后端服务

```bash
ssh -i ~/.ssh/doxmind-ec2-key.pem ubuntu@api.doxmind.com << 'EOF'
cd /opt/doxmind
docker compose --env-file .env.production -f docker-compose.prod.yml restart backend
EOF
```

### 查看环境变量

```bash
ssh -i ~/.ssh/doxmind-ec2-key.pem ubuntu@api.doxmind.com << 'EOF'
cd /opt/doxmind
cat .env.production
EOF
```

## 数据库操作

### 连接到 PostgreSQL

```bash
ssh -i ~/.ssh/doxmind-ec2-key.pem ubuntu@api.doxmind.com << 'EOF'
cd /opt/doxmind
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T postgres \
  psql -U doxmind -d doxmind
EOF
```

### 执行 SQL 查询

```bash
ssh -i ~/.ssh/doxmind-ec2-key.pem ubuntu@api.doxmind.com << 'EOF'
cd /opt/doxmind
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T postgres \
  psql -U doxmind -d doxmind -c "SELECT COUNT(*) FROM users;"
EOF
```

### 列出所有索引

```bash
ssh -i ~/.ssh/doxmind-ec2-key.pem ubuntu@api.doxmind.com << 'EOF'
cd /opt/doxmind
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T postgres \
  psql -U doxmind -d doxmind -c "\di"
EOF
```

### 删除索引（如果存在）

```bash
ssh -i ~/.ssh/doxmind-ec2-key.pem ubuntu@api.doxmind.com << 'EOF'
cd /opt/doxmind
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T postgres \
  psql -U doxmind -d doxmind -c "DROP INDEX IF EXISTS index_name;"
EOF
```

## 常见问题

### 1. 连接超时

**错误**: `ssh: connect to host ... port 22: Connection timed out`

**原因**:

- 使用了错误的主机名（如使用 EC2 IP 而不是域名）
- EC2 安全组未允许你的 IP

**解决方案**:

- 使用域名 `api.doxmind.com` 而不是 EC2 IP 地址
- 检查 EC2 安全组配置

### 2. Permission denied

**错误**: `Permission denied (publickey)`

**原因**: SSH key 权限不正确

**解决方案**:

```bash
chmod 600 ~/.ssh/doxmind-ec2-key.pem
```

### 3. 数据库迁移失败

**错误**: `relation "xxx" already exists`

**解决方案**:

1. SSH 到服务器
2. 手动删除冲突的索引/表
3. 重新运行迁移

示例：

```bash
ssh -i ~/.ssh/doxmind-ec2-key.pem ubuntu@api.doxmind.com << 'EOF'
cd /opt/doxmind
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T postgres \
  psql -U doxmind -d doxmind -c "DROP INDEX IF EXISTS idx_telemetry_user_type;"
docker compose --env-file .env.production -f docker-compose.prod.yml run --rm backend alembic upgrade head
EOF
```

## 重要提示

1. **永远不要使用 EC2 IP 地址连接**，使用域名 `api.doxmind.com`
2. **执行危险操作前先备份**（如删除表、索引等）
3. **查看日志时使用 `--tail` 限制输出**，避免占用太多带宽
4. **生产环境操作需谨慎**，建议先在本地测试

## SSH Config 配置（可选）

为了简化连接，可以在 `~/.ssh/config` 中添加：

```
Host doxmind-prod
    HostName api.doxmind.com
    User ubuntu
    IdentityFile ~/.ssh/doxmind-ec2-key.pem
    ServerAliveInterval 30
    ServerAliveCountMax 10
```

然后可以直接使用：

```bash
ssh doxmind-prod
```

## 相关文档

- [CLAUDE.md](../CLAUDE.md) - 项目整体文档
- [Docker Compose Production](../docker-compose.prod.yml) - 生产环境配置
- [GitHub Actions Deploy](.github/workflows/deploy.yml) - 自动部署配置
