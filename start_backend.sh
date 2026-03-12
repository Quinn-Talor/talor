#!/bin/bash

# Start Talor backend with logging visible

cd talor

# Set logging level to DEBUG for debugging
export LOGLEVEL=INFO
export TALOR_WORKSPACE=$(pwd)

echo "Starting Talor backend..."
echo "Workspace: $TALOR_WORKSPACE"

# Start the server
python3 -m uvicorn src.api.app:app \
  --host 0.0.0.0 \
  --port 8000 \
  --reload \
  --log-level info
