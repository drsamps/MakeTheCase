#!/bin/bash

APP_NAME="makethecase"
APP_DIR="/var/www/jsapps/makethecase"
ENTRY_FILE="server/index.js"

echo "🔄 Restarting $APP_NAME..."
cd "$APP_DIR" || { echo "❌ Cannot cd to $APP_DIR"; exit 1; }

# 1. Check if PM2 knows about the app
if pm2 list | grep -q "$APP_NAME"; then
    echo "▶️  PM2 process found. Restarting..."
    pm2 restart "$APP_NAME"
else
    echo "⚠️  PM2 process not found. Starting fresh..."
    pm2 start "$ENTRY_FILE" --name "$APP_NAME"
fi

# 2. Give it a moment to boot
sleep 2

# 3. Check status
STATUS=$(pm2 jlist | jq -r ".[] | select(.name==\"$APP_NAME\") | .pm2_env.status")

if [[ "$STATUS" == "online" ]]; then
    echo "✅ $APP_NAME is RUNNING"
    pm2 status "$APP_NAME"
    exit 0
else
    echo "❌ $APP_NAME failed to start (status: $STATUS)"
    echo
    echo "📄 Last 40 log lines:"
    pm2 logs "$APP_NAME" --lines 40
    exit 1
fi
