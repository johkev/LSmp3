#!/bin/sh
set -eu

PROJECT_DIR=/home/kevin/laensmann-mp3

cd "$PROJECT_DIR"
/usr/bin/flock -n /tmp/mp3-pull-deploy.lock sh -c '
  git fetch origin main
  git reset --hard origin/main
  npm ci --omit=dev
  sudo /usr/bin/systemctl restart mp3-api.service
  sudo /usr/bin/systemctl is-active --quiet mp3-api.service
  /usr/bin/curl --fail --silent http://127.0.0.1:3002/api/health > /dev/null
'