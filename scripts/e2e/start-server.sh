#!/bin/bash
# 启动 samoffice-server 并保持运行（不随 shell 退出）
cd /home/z/my-project/samoffice
pkill -f samoffice-server 2>/dev/null
sleep 2
rm -rf /tmp/samoffice-pw-test
nohup /tmp/samoffice-server --addr 127.0.0.1:18400 --data /tmp/samoffice-pw-test </dev/null >/tmp/server-pw.log 2>&1 &
disown
echo "Started server PID=$!"
