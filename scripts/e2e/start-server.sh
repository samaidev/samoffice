#!/bin/bash
# 启动 gooffice-server 并保持运行（不随 shell 退出）
cd /home/z/my-project/gooffice
pkill -f gooffice-server 2>/dev/null
sleep 2
rm -rf /tmp/gooffice-pw-test
nohup /tmp/gooffice-server --addr 127.0.0.1:18400 --data /tmp/gooffice-pw-test </dev/null >/tmp/server-pw.log 2>&1 &
disown
echo "Started server PID=$!"
