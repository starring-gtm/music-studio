#!/usr/bin/env bash
# Upload a song, poll until separation finishes, then download the stems zip.
# Usage: scripts/smoke_test.sh [song] [model]
set -euo pipefail

API=${API:-http://localhost:8000}
SONG=${1:-../audio/song.mp3}
MODEL=${2:-htdemucs_6s}

json() { python3 -c "import sys, json; d = json.load(sys.stdin); print($1)"; }

id=$(curl -sSf -F "file=@$SONG" -F "model=$MODEL" "$API/api/jobs" | json 'd["id"]')
echo "job $id"

while :; do
  body=$(curl -sSf "$API/api/jobs/$id")
  status=$(echo "$body" | json 'd["status"]')
  echo "  $status / $(echo "$body" | json 'd.get("stage")')"
  case $status in
    finished) break ;;
    failed) echo "$body"; exit 1 ;;
  esac
  sleep 3
done

echo "$body" | python3 -m json.tool
curl -sSf -o "stems-$id.zip" "$API/api/jobs/$id/stems.zip"
echo "saved stems-$id.zip"
