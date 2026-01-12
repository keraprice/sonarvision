#!/bin/bash

# Activate the virtual environment
cd "$(dirname "$0")"
if [ -d "../venv" ]; then
    source ../venv/bin/activate
fi

# Start the backend in the background
python transcriber_server.py &
BACKEND_PID=$!

# Wait a moment for the server to start
sleep 2

# Open the app in the default browser
open http://127.0.0.1:5000/

# Wait for the backend process to finish
wait $BACKEND_PID 