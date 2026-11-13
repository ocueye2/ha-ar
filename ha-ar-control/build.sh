#!/bin/bash
# Build the image and zip the project for sharing.
set -e
cd "$(dirname "$0")"
docker build -t ha-ar-control:latest . 2>/dev/null || echo "docker build skipped/failed — zip still made"
zip -r ha-ar-control.zip . -x "data/*" "*.pyc" "__pycache__/*" ".git/*" "ha-ar-control.zip" ".env"
echo "built ha-ar-control.zip"
ls -lh ha-ar-control.zip
