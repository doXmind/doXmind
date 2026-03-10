#!/bin/bash
# =============================================================================
# doXmind Health Monitoring Script
# =============================================================================
# Checks all Docker containers and system resources.
# Auto-restarts failed containers.
#
# Cron setup (add via: crontab -e):
#   * * * * * /opt/doxmind/scripts/monitor.sh
# =============================================================================

set -uo pipefail

LOG_DIR="/opt/doxmind/logs"
LOG_FILE="${LOG_DIR}/monitor.log"
mkdir -p "$LOG_DIR"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
}

# =========================================================================
# Check Docker container status
# =========================================================================
check_container() {
    local name=$1
    local container=$2
    if ! docker inspect --format='{{.State.Running}}' "$container" 2>/dev/null | grep -q true; then
        log "ALERT: $name ($container) is NOT running!"
        return 1
    fi
    return 0
}

ALL_OK=true

check_container "Backend"    "doxmind-backend"  || ALL_OK=false
check_container "Frontend"   "doxmind-frontend" || ALL_OK=false
check_container "PostgreSQL" "doxmind-postgres" || ALL_OK=false
check_container "Redis"      "doxmind-redis"    || ALL_OK=false
check_container "Nginx"      "doxmind-nginx"    || ALL_OK=false

# =========================================================================
# HTTP health check
# =========================================================================
HTTP_STATUS=$(curl -sf -o /dev/null -w "%{http_code}" http://localhost:8000/health 2>/dev/null || echo "000")
if [ "$HTTP_STATUS" != "200" ]; then
    log "ALERT: Backend health check returned HTTP $HTTP_STATUS"
    ALL_OK=false
fi

# =========================================================================
# System resource checks
# =========================================================================
DISK_USAGE=$(df /opt/doxmind | tail -1 | awk '{print $5}' | tr -d '%')
if [ "$DISK_USAGE" -gt 80 ]; then
    log "WARNING: Disk usage at ${DISK_USAGE}%"
fi

MEM_USAGE=$(free | awk '/Mem:/ {printf("%.0f", $3/$2 * 100)}')
if [ "$MEM_USAGE" -gt 90 ]; then
    log "WARNING: Memory usage at ${MEM_USAGE}%"
fi

# =========================================================================
# PostgreSQL connection count
# =========================================================================
PG_CONNS=$(docker exec doxmind-postgres psql -U doxmind -d doxmind -tAc \
    "SELECT count(*) FROM pg_stat_activity;" 2>/dev/null || echo "?")

# =========================================================================
# Log status line (every run)
# =========================================================================
log "Status: HTTP=$HTTP_STATUS Disk=${DISK_USAGE}% Mem=${MEM_USAGE}% PG_Conns=$PG_CONNS"

# =========================================================================
# Auto-restart if any service is down
# =========================================================================
if [ "$ALL_OK" = false ]; then
    log "Attempting auto-restart of services..."
    cd /opt/doxmind && docker compose -f docker-compose.prod.yml up -d 2>> "$LOG_FILE"
    log "Auto-restart triggered"
fi

# =========================================================================
# Log rotation: truncate if > 100MB
# =========================================================================
if [ -f "$LOG_FILE" ]; then
    FILE_SIZE=$(stat -c%s "$LOG_FILE" 2>/dev/null || stat -f%z "$LOG_FILE" 2>/dev/null || echo "0")
    if [ "$FILE_SIZE" -gt 104857600 ]; then
        tail -n 10000 "$LOG_FILE" > "${LOG_FILE}.tmp"
        mv "${LOG_FILE}.tmp" "$LOG_FILE"
        log "Log file rotated (was over 100MB)"
    fi
fi
