#!/bin/bash

# Script to restart npm applications
# Dynamically finds and stops processes, then restarts them

echo "=== Restarting NPM Applications ==="
echo ""

# Function to kill process by PID
kill_process() {
    local pid=$1
    local name=$2

    if kill -0 $pid 2>/dev/null; then
        echo "Stopping $name (PID: $pid)..."
        kill $pid 2>/dev/null
        sleep 1

        # Check if still running, force kill if necessary
        if kill -0 $pid 2>/dev/null; then
            echo "  Process still running, forcing kill..."
            kill -9 $pid 2>/dev/null
        fi
        echo "  $name stopped"
    else
        echo "$name (PID: $pid) not found or already stopped"
    fi
}

# Function to kill process by port
kill_by_port() {
    local port=$1
    echo "Checking for processes on port $port..."
    local pid=$(lsof -ti:$port 2>/dev/null)

    if [ ! -z "$pid" ]; then
        echo "  Found process(es) on port $port: $pid"
        for p in $pid; do
            kill_process $p "Process on port $port"
        done
    else
        echo "  No process found on port $port"
    fi
}

echo "=== Stopping Applications ==="
echo ""

# Find and kill npm processes
echo "Looking for npm processes..."

# Find 'npm run frontend' process
FRONTEND_PID=$(pgrep -f "npm run frontend")
if [ ! -z "$FRONTEND_PID" ]; then
    for pid in $FRONTEND_PID; do
        kill_process $pid "Frontend npm process"
    done
else
    echo "No 'npm run frontend' process found"
fi

# Find 'npm start' process
BACKEND_PID=$(pgrep -f "npm start")
if [ ! -z "$BACKEND_PID" ]; then
    for pid in $BACKEND_PID; do
        kill_process $pid "Backend npm process"
    done
else
    echo "No 'npm start' process found"
fi

echo ""
echo "Checking ports 3000 and 3001..."

# Kill any process on port 3000
kill_by_port 3000

# Kill any process on port 3001
kill_by_port 3001

# Wait for ports to be free
echo ""
echo "Waiting for ports to be released..."
sleep 2

# Verify ports are free
echo ""
echo "Verifying ports are available..."
PORT_3000=$(lsof -ti:3000 2>/dev/null)
PORT_3001=$(lsof -ti:3001 2>/dev/null)

if [ ! -z "$PORT_3000" ]; then
    echo "WARNING: Port 3000 is still in use by PID: $PORT_3000"
fi

if [ ! -z "$PORT_3001" ]; then
    echo "WARNING: Port 3001 is still in use by PID: $PORT_3001"
fi

echo ""
echo "=== Starting Applications ==="
echo ""

# Start the frontend app
echo "Starting frontend app..."
cd /path/to/frontend/directory  # UPDATE THIS PATH
nohup npm run frontend -- --host > frontend.log 2>&1 &
NEW_FRONTEND_PID=$!
echo "  Frontend started with PID: $NEW_FRONTEND_PID"

# Wait a moment before starting backend
sleep 1

# Start the backend app
echo "Starting backend app..."
cd /path/to/backend/directory  # UPDATE THIS PATH
nohup npm start > backend.log 2>&1 &
NEW_BACKEND_PID=$!
echo "  Backend started with PID: $NEW_BACKEND_PID"

echo ""
echo "=== Restart Complete ==="
echo "New PIDs:"
echo "  Frontend: $NEW_FRONTEND_PID"
echo "  Backend: $NEW_BACKEND_PID"
echo ""
echo "Monitor applications:"
echo "  ps -p $NEW_FRONTEND_PID,$NEW_BACKEND_PID"
echo ""
echo "Check logs:"
echo "  tail -f /path/to/frontend/directory/frontend.log"
echo "  tail -f /path/to/backend/directory/backend.log"
echo ""
echo "Check ports:"
echo "  lsof -i:3000"
echo "  lsof -i:3001"
