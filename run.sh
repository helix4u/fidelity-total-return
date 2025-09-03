#!/usr/bin/env bash
set -euo pipefail

# Launch the Node.js backend instead of the Python one
cd "$(dirname "$0")/node-app"
npm install
npm start
