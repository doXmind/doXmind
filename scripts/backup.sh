#!/bin/bash
# =============================================================================
# doXmind PostgreSQL Backup Script
# =============================================================================
# Performs daily pg_dump and uploads to S3.
#
# Cron setup (add via: crontab -e):
#   0 4 * * * /opt/doxmind/scripts/backup.sh >> /opt/doxmind/backups/cron.log 2>&1
# =============================================================================

set -euo pipefail

# Configuration
BACKUP_DIR="/opt/doxmind/backups"
S3_BUCKET="doxmind"
S3_PREFIX="backups/postgres"
LOCAL_RETENTION_DAYS=7
S3_RETENTION_DAYS=30
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
DUMP_FILE="${BACKUP_DIR}/doxmind_${TIMESTAMP}.dump"
LOG_FILE="${BACKUP_DIR}/backup.log"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# Create backup directory if needed
mkdir -p "$BACKUP_DIR"

log "=== Starting backup ==="

# =========================================================================
# Step 1: Dump database from Docker container
# =========================================================================
docker exec doxmind-postgres pg_dump \
  -U doxmind \
  -d doxmind \
  --format=custom \
  --compress=9 \
  --verbose \
  > "$DUMP_FILE" 2>> "$LOG_FILE"

DUMP_SIZE=$(ls -lh "$DUMP_FILE" | awk '{print $5}')
log "Dump created: $DUMP_FILE ($DUMP_SIZE)"

# =========================================================================
# Step 2: Verify backup integrity
# =========================================================================
if pg_restore --list "$DUMP_FILE" > /dev/null 2>&1; then
    log "Backup integrity verified: OK"
else
    log "ERROR: Backup integrity check failed!"
    exit 1
fi

# =========================================================================
# Step 3: Upload to S3 (Infrequent Access tier for cost savings)
# =========================================================================
S3_KEY="${S3_PREFIX}/doxmind_${TIMESTAMP}.dump"
aws s3 cp "$DUMP_FILE" "s3://${S3_BUCKET}/${S3_KEY}" \
  --storage-class STANDARD_IA 2>> "$LOG_FILE"
log "Uploaded to S3: s3://${S3_BUCKET}/${S3_KEY}"

# =========================================================================
# Step 4: Clean up old local backups (keep 7 days)
# =========================================================================
DELETED_LOCAL=$(find "$BACKUP_DIR" -name "doxmind_*.dump" -mtime +${LOCAL_RETENTION_DAYS} -print -delete | wc -l)
if [ "$DELETED_LOCAL" -gt 0 ]; then
    log "Cleaned up $DELETED_LOCAL local backups older than ${LOCAL_RETENTION_DAYS} days"
fi

# =========================================================================
# Step 5: Clean up old S3 backups (keep 30 days)
# =========================================================================
CUTOFF_DATE=$(date -d "-${S3_RETENTION_DAYS} days" +%Y-%m-%d 2>/dev/null || date -v-${S3_RETENTION_DAYS}d +%Y-%m-%d)
aws s3 ls "s3://${S3_BUCKET}/${S3_PREFIX}/" | while read -r line; do
    BACKUP_DATE=$(echo "$line" | awk '{print $1}')
    BACKUP_FILE=$(echo "$line" | awk '{print $4}')
    if [ -n "$BACKUP_FILE" ] && [ "$BACKUP_DATE" \< "$CUTOFF_DATE" ]; then
        aws s3 rm "s3://${S3_BUCKET}/${S3_PREFIX}/${BACKUP_FILE}" 2>> "$LOG_FILE"
        log "Deleted old S3 backup: $BACKUP_FILE"
    fi
done

log "=== Backup complete ==="
