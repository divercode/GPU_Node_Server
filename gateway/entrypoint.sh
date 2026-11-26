#!/bin/sh
set -eu

# 自定义配置渲染：只替换网关共享密钥，保留 Nginx 自己的 $host/$request_uri 等变量。
# 输出到 /tmp 以适配只读根文件系统与非 root worker。
secret="${PORTAL_PROXY_SECRET:?PORTAL_PROXY_SECRET is required}"
case "$secret" in
  *"|"*|*"&"*) echo "PORTAL_PROXY_SECRET must not contain | or &" >&2; exit 1 ;;
esac
mkdir -p /tmp/nginx/conf.d
sed "s|\${PORTAL_PROXY_SECRET}|${secret}|g" \
  /etc/nginx/portal.conf.template \
  > /tmp/nginx/conf.d/portal.conf
