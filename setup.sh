#!/bin/bash

echo "🚀 WhatsApp Recent Chats - Setup Script"
echo "========================================"
echo ""

# Check if Homebrew is installed
if ! command -v brew &> /dev/null; then
    echo "❌ Homebrew is not installed."
    echo "Please install Homebrew first: https://brew.sh/"
    exit 1
fi

echo "✅ Homebrew is installed"

# Check if SQLite3 is installed
if ! command -v sqlite3 &> /dev/null; then
    echo "📦 Installing SQLite3..."
    brew install sqlite3
else
    echo "✅ SQLite3 is already installed"
fi

# Check SQLite3 version
echo "📋 SQLite3 version:"
sqlite3 --version

echo ""
echo "🔧 Next Steps:"
echo "1. Install Raycast: https://raycast.com/"
echo "2. Grant Full Disk Access to Raycast in System Settings"
echo "3. Install WhatsApp Desktop: https://www.whatsapp.com/download"
echo "4. Use WhatsApp Desktop at least once"
echo "5. Install this extension in Raycast"
echo ""
echo "📖 For detailed instructions, see README.md"
