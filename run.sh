#!/usr/bin/env bash

echo "Starting CampusShield with MongoDB Atlas..."

# Open the application in the browser
xdg-open "http://localhost:5000" >/dev/null 2>&1 &

# Start the Node.js application
npm start
