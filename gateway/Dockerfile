FROM nginxinc/nginx-unprivileged:1.27-alpine

COPY gateway/nginx.conf /etc/nginx/nginx.conf
COPY gateway/portal.conf.template /etc/nginx/portal.conf.template
COPY gateway/entrypoint.sh /docker-entrypoint.d/40-portal-config.sh
USER root
RUN chmod 0755 /docker-entrypoint.d/40-portal-config.sh \
    && rm -f /etc/nginx/conf.d/default.conf
USER 101
COPY frontend/ /usr/share/nginx/html/

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
