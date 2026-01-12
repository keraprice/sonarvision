#!/bin/bash

echo "🐬 Starting JIRA Analytics Dashboard for SonarVision..."

# Navigate to the JIRA dashboard directory
cd /Users/keraprice/source/jira-ba-dashboard-main

# Check if node_modules exists, if not install dependencies
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

# Start both servers in the background
echo "🚀 Starting JIRA Analytics Dashboard servers..."
echo "📊 Frontend will be available at: http://localhost:5173/"
echo "🔧 Backend API will be available at: http://localhost:8000/"
echo "🔗 SonarVision will automatically detect when the dashboard is running"
echo ""
echo "Press Ctrl+C to stop both servers"

# Start the backend server in the background
echo "🔧 Starting backend API server..."
npm run server &
BACKEND_PID=$!

# Wait a moment for backend to start
sleep 3

# Start the frontend development server
echo "🎨 Starting frontend development server..."
npm run dev &
FRONTEND_PID=$!

# Function to cleanup background processes
cleanup() {
    echo ""
    echo "🛑 Stopping JIRA Dashboard servers..."
    kill $BACKEND_PID 2>/dev/null
    kill $FRONTEND_PID 2>/dev/null
    exit 0
}

# Set up signal handlers
trap cleanup SIGINT SIGTERM

# Wait for both processes
wait
