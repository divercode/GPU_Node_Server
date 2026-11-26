# 演示账号与部署凭据清单

> 仅用于当前内网原型/M0 联调。生产前必须更换全部密码，并删除 Dex 静态密码与本地 auth_users 演示账号。
> 本文件含明文演示密码，不要提交到公开仓库或对外发送。

## 1. 平台登录账号

同一组账号在两种入口使用不同登录格式：

- **当前 8080 本地认证**：用户名（不带 `@`）
- **容器/Dex OIDC**：邮箱地址（带 `@hpc.local`）

| 姓名 | 本地用户名 | Dex 登录邮箱 | 密码 | 角色 | 课题组 |
|---|---|---|---|---|---|
| 林予安 | `linya` | `linya@hpc.local` | `Admin@12345` | 平台管理员 | 平台组 |
| 陈砚舟 | `chenyz` | `chenyz@hpc.local` | `Ops@12345` | 运维人员 | 运维组 |
| 张启明 | `zhangqm` | `zhangqm@hpc.local` | `Pi@12345` | PI（课题组负责人） | 智能计算组 |
| 沈亦然 | `shenyr` | `shenyr@hpc.local` | `User@12345` | 普通用户 | 智能计算组 |

已验证：密码与 `backend/auth_users.json` 的 PBKDF2 哈希、`dex/config.yaml.tmpl` 的 bcrypt 哈希均一致。

## 2. 登录地址

| 入口 | 地址 | 登录格式 |
|---|---|---|
| 当前本地认证 | http://192.168.10.60:8080/ | `linya` / `Admin@12345` |
| 容器 + Dex OIDC | http://<目标机IP>:8080/ | `linya@hpc.local` / `Admin@12345` |

## 3. 部署凭据（非登录账号）

以下密钥在项目根目录 `.env`，用于服务间通信/采集，不是用户密码：

| 变量 | 用途 |
|---|---|
| `OAUTH2_PROXY_CLIENT_SECRET` | Dex OAuth2 客户端 `portal` 的 secret |
| `OAUTH2_PROXY_COOKIE_SECRET` | oauth2-proxy 会话 cookie 加密 |
| `PORTAL_PROXY_SECRET` | Nginx 网关 → backend 身份头共享密钥 |
| `PORTAL_SESSION_SECRET` | 本地模式会话签名 |
| `PORTAL_COLLECTOR_TOKEN` | GPU agent 上报 token |
| `POSTGRES_PASSWORD` | PostgreSQL `starrail` 用户密码 |
| `REDIS_PASSWORD` | Redis 访问密码 |

查看方式：

```powershell
Get-Content D:\算力运维平台\.env
```

## 4. 尚未创建的账号

当前项目**没有**创建以下账号/密码：

- 两台 GPU 服务器的 Linux SSH/OS 账号；
- FreeIPA/LDAP 用户与 bind DN；
- Slurm 用户、Account、QOS；
- PostgreSQL、MariaDB、Redis 业务账号；
- 真实 OOD 登录账号；
- 任何公网/云平台账号。

生产环境建议：

- OS 管理使用独立管理员账号 + SSH key，禁用 root 密码登录；
- LDAP/FreeIPA 账号由运维在 FreeIPA 创建，平台不保存用户密码；
- 只读服务账号（LDAP bind、Prometheus、backend、agent）单独创建并最小权限；
- 所有演示密码上线前更换。
