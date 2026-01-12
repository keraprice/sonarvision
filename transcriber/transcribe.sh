#!/bin/bash

# Video Transcription Script
# Usage: ./transcribe.sh [video_file] [options]

# Activate virtual environment if it exists
if [ -d "../venv" ]; then
    source ../venv/bin/activate
fi

# Check if any arguments were provided
if [ $# -eq 0 ]; then
    echo "🎬 VIDEO TRANSCRIPTION TOOL"
    echo "=========================="
    echo ""
    echo "No video file specified. Starting interactive mode..."
    echo ""
    python transcribe_video.py --interactive
    exit 0
fi

# Check if first argument is a help flag
if [[ "$1" == "-h" || "$1" == "--help" ]]; then
    echo "Usage: $0 [video_file] [options]"
    echo ""
    echo "Examples:"
    echo "  $0                    # Interactive mode"
    echo "  $0 video.mp4          # Transcribe specific file"
    echo "  $0 video.mp4 -nr 2    # With noise reduction"
    echo "  $0 video.mp4 -iv 1.5  # With volume boost"
    echo "  $0 video.mp4 -l en-US # Different language"
    echo ""
    echo "Options:"
    echo "  -nr 1|2    Noise reduction (1=basic, 2=massive)"
    echo "  -iv 0.1-3.0 Volume boost"
    echo "  -l lang    Language code (e.g., en-US, es-ES)"
    echo "  -o file    Output file name"
    echo "  --interactive  Force interactive mode"
    echo "  --keep-audio   Keep extracted audio file"
    exit 0
fi

# Run the transcription with all arguments
python transcribe_video.py "$@" 