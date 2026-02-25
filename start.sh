#!/bin/sh
# Replace __PORT__ placeholder with Railway's $PORT (default 80)
sed -i "s/__PORT__/${PORT:-80}/g" /etc/nginx/conf.d/default.conf
nginx -g 'daemon off;'
