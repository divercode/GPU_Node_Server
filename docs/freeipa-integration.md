# FreeIPA / LDAP 接入说明

## 现状

FreeIPA 已部署在 230 的 KVM 虚拟机中，平台和 OOD 已改为 FreeIPA 身份认证。

```text
FreeIPA VM:
  OS: Rocky Linux 9.9
  IP: 192.168.122.10 (libvirt default NAT)
  Hostname: ipa.hpc.internal
  Domain: hpc.internal
  Realm: HPC.INTERNAL
  Web: https://192.168.112.230/ipa/  （经 230 端口代理）
  LDAP: ldap://192.168.112.230:389
  LDAPS: ldaps://192.168.112.230:636
```

230 上通过 systemd + socat 转发 FreeIPA 端口：

```text
389, 636, 88, 464, 443 -> 192.168.122.10
```

服务单元：

```text
freeipa-tcp@389
freeipa-tcp@636
freeipa-tcp@88
freeipa-tcp@464
freeipa-tcp@443
freeipa-udp@88
freeipa-udp@464
```

## 客户端入域

230、105 均已执行 FreeIPA client 入域：

```bash
ipa-client-install --unattended \
  --server=ipa.hpc.internal \
  --domain=hpc.internal \
  --realm=HPC.INTERNAL \
  --principal=admin \
  --password='<IPA_ADMIN_PASSWORD>' \
  --hostname=gpu230.hpc.internal \
  --mkhomedir --force-join --no-dns-sshfp
```

两个节点均通过 SSSD 解析 FreeIPA 用户：

```text
linya:*:1879200005:1879200005:Lin Ya:/home/linya:/bin/bash
groups: hpc-admins, hpc-users
```

## Dex 接入

`dex/config.yaml.tmpl` 已从静态账号切换为 FreeIPA LDAP connector：

```yaml
enablePasswordDB: false
connectors:
  - type: ldap
    id: ldap
    name: "FreeIPA"
    config:
      host: "192.168.112.230:389"
      insecureNoSSL: true
      bindDN: "uid=dex-bind,cn=users,cn=accounts,dc=hpc,dc=internal"
      bindPW: "<DEX_BIND_PASSWORD>"
      userSearch:
        baseDN: "cn=users,cn=accounts,dc=hpc,dc=internal"
        filter: "(objectClass=posixAccount)"
        username: uid
        idAttr: uid
        emailAttr: mail
        # FreeIPA 的 admin 等特殊账号没有 displayName/mail，用 cn + emailSuffix 兜底
        emailSuffix: hpc.local
        nameAttr: cn
        preferredUsernameAttr: uid
      groupSearch:
        baseDN: "cn=groups,cn=accounts,dc=hpc,dc=internal"
        filter: "(objectClass=posixGroup)"
        userMatchers:
          - userAttr: uid
            groupAttr: member
        nameAttr: cn
```

Dex 仍保留 OIDC client：

- `ood`：OOD 登录
- `portal`：平台 oauth2-proxy

## 登录方式

当前按要求关闭了 TOTP，管理员 `linya` 使用纯密码登录：

```text
用户名：linya
密码：Admin@12345
```

FreeIPA 中的认证类型已设置为：

```text
User authentication types: password
```

原来的 `linya admin OTP` 令牌已删除，`/root/linya-otp.txt` 也已移除。

OOD 和平台均已验证密码登录成功。

> FreeIPA 的 `admin` 是特殊的目录管理账号，不能设置 `mail` / `displayName`。
> Dex 已用 `nameAttr: cn` + `emailSuffix: hpc.local` 兜底，`admin` 可以登录门户/OOD；
> 日常平台/OOD 管理建议使用 `linya`，`admin` 仅用于 `kinit` 和 IPA 管理。
>
> 如后续需要重新启用 MFA，可执行：
>
> ```bash
> kinit admin
> ipa user-mod linya --user-auth-type=otp
> ipa otptoken-add --type=totp --owner=linya --desc='linya admin OTP'
> ```

## 统一入口

8080 是唯一书签：

```text
http://192.168.112.230:8080/
```

登录后默认进入平台工作台（`#/dashboard`）。统一入口在左侧导航“统一入口”，也可直接访问：

```text
http://192.168.112.230:8080/#/entrance
```

入口按角色渲染：

| 角色 | 入口 |
|---|---|
| 普通用户 / PI / 审计 | 算力运维平台、OOD 终端与门户 |
| 运维 | 平台、OOD、Prometheus、Alertmanager |
| 管理员 | 平台、OOD、Prometheus、Alertmanager、FreeIPA 身份管理 |

管理员额外入口：

```text
FreeIPA：    https://192.168.112.230/ipa/
Prometheus： http://192.168.112.230:9090/
Alertmanager:http://192.168.112.230:9093/
```

平台内部页面仍保留侧栏导航；登录后默认进入工作台，统一入口从侧栏或 Logo 打开。

## 访问入口

```text
平台：http://192.168.112.230:8080/
OOD ：http://192.168.112.230/
FreeIPA Web：https://192.168.112.230/ipa/
```

平台使用 Dex OIDC，已关闭 `approval_prompt`，登录后直接进入工作台，不再出现 Grant Access 授权页。

oauth2-proxy 使用 Redis 会话存储，浏览器只保存一个很短的会话 Cookie（`starrail_oauth2_v2`）；如果登录后反复回到 Dex 登录页，清除 `192.168.112.230` 的旧 Cookie 后重试。

## 常用管理命令

```bash
kinit admin
ipa user-find
ipa group-find
ipa user-add <user> --first=... --last=... --password
ipa group-add-member hpc-users --users=<user>

# 查看用户认证方式
ipa user-show linya --all
```

## 注意

- FreeIPA 没有启用 DNS 服务；230/105 通过 `/etc/hosts` 和显式 `--server` 入域。生产建议后续启用 FreeIPA DNS 或内部 DNS 转发。
- FreeIPA VM 已设置 libvirt autostart。
- FreeIPA 端口代理是 systemd 服务，已 enable。
- OOD 的用户不再使用本地 `/etc/passwd` 账号，FreeIPA 用户通过 SSSD 解析。
- 当前 `linya` 已关闭 TOTP，使用纯密码登录；如需重新启用，按上方命令添加 OTP 令牌。
