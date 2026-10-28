#!/usr/bin/env bash
# Start, stop or check the Mist Bank send worker on the operator box (see scripts/mist-worker.js).
# The loop restarts the worker 10 s after any exit. After a box reboot, run: bash backend/scripts/mist-worker.sh start
set -u
DIR=$(cd "$(dirname "$0")/.." && pwd)
ENVF=${MIST_ENV:-/workspace/near/.secrets/mist-worker.env}
RUN=${MIST_RUN:-/workspace/near/run}; mkdir -p "$RUN"
PID=$RUN/mist-worker.pid LOG=$RUN/mist-worker.log
alive() { [ -f "$PID" ] && kill -0 "$(cat "$PID")" 2>/dev/null; }
case "${1:-status}" in
  start)
    alive && { echo "running (pid $(cat "$PID"))"; exit 0; }
    [ -r "$ENVF" ] || { echo "missing $ENVF"; exit 2; }
    setsid nohup bash -c "set -a; . '$ENVF'; set +a; cd '$DIR'; while :; do node scripts/mist-worker.js; echo \"\$(date -Is) worker exited \$?, restart in 10 s\"; sleep 10; done" >>"$LOG" 2>&1 < /dev/null &
    echo $! > "$PID"; sleep 1; alive && echo "started (pid $(cat "$PID")), log $LOG" ;;
  stop) alive && { kill -- -"$(cat "$PID")" 2>/dev/null || kill "$(cat "$PID")"; rm -f "$PID"; echo stopped; } || echo "not running" ;;
  status) alive && echo "running (pid $(cat "$PID"))" || { echo "not running"; exit 1; }; tail -n 5 "$LOG" 2>/dev/null ;;
  *) echo "usage: $0 start|stop|status"; exit 2 ;;
esac
