#!/bin/bash

echo "🐬 Starting SonarVision with Local Transcription..."

# Ensure venv exists
if [ ! -d "venv" ]; then
    echo "🐍 Creating virtual environment..."
    python3 -m venv venv
fi

VENV_PY="venv/bin/python"
VENV_PIP="venv/bin/pip"

# Check if Python is installed
if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 is not installed. Please install Python 3 first."
    exit 1
fi

# Check if ffmpeg is installed
if ! command -v ffmpeg &> /dev/null; then
    echo "❌ ffmpeg is not installed. Please install ffmpeg first:"
    echo "   macOS: brew install ffmpeg"
    echo "   Ubuntu: sudo apt install ffmpeg"
    exit 1
fi

# Check if required Python packages are installed
echo "📦 Checking Python dependencies..."
$VENV_PY -c "import flask, flask_cors, noisereduce, numpy, speech_recognition, pydub, scipy, tqdm" 2>/dev/null
if [ $? -ne 0 ]; then
    echo "📦 Installing Python dependencies..."
    $VENV_PIP install -r requirements.txt
    $VENV_PIP install -r transcriber/requirements.txt
fi

# Create temp_uploads directory if it doesn't exist
mkdir -p temp_uploads

# Start transcription server in background
echo "🎬 Starting transcription server on port 5001..."
$VENV_PY transcription_server.py &
TRANSCRIPTION_PID=$!

# Wait a moment for the server to start
sleep 2

# Check if transcription server started successfully
if curl -s http://localhost:5001/health > /dev/null; then
    echo "✅ Transcription server is running"
else
    echo "❌ Failed to start transcription server"
    kill $TRANSCRIPTION_PID 2>/dev/null
    exit 1
fi

# Start web server
echo "🌐 Starting web server on port 8000..."
echo "📱 Open your browser to: http://localhost:8000"
echo "🎬 Transcription server: http://localhost:5001"
echo ""
echo "Press Ctrl+C to stop both servers"

# Function to cleanup on exit
cleanup() {
    echo ""
    echo "🛑 Stopping servers..."
    kill $TRANSCRIPTION_PID 2>/dev/null
    echo "✅ Servers stopped"
    exit 0
}

# Set trap to cleanup on script exit
trap cleanup SIGINT SIGTERM

# Start web server
python3 -m http.server 8000

# If we get here, cleanup
cleanup
