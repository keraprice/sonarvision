# Quick Start Guide

## 🚀 Ready to Transcribe!

You now have a robust video transcription tool based on the [mirawara/transcriber](https://github.com/mirawara/transcriber) project that handles large files by splitting them into chunks during silent moments.

## 📋 Prerequisites

Make sure you have **ffmpeg** installed:
```bash
# macOS
brew install ffmpeg

# Ubuntu/Debian  
sudo apt install ffmpeg
```

## 🎯 Quick Commands

### Interactive mode (easiest):
```bash
python transcribe_video.py
```
or
```bash
./transcribe.sh
```

### Direct file transcription:
```bash
python transcribe_video.py your_video.mp4
```

### With bash script:
```bash
./transcribe.sh your_video.mp4
```

### For noisy audio:
```bash
python transcribe_video.py your_video.mp4 -nr 2 -iv 1.5
```

### Different language:
```bash
python transcribe_video.py your_video.mp4 -l en-US
```

## 🎬 Interactive Mode

The tool now supports interactive mode! Just run:
```bash
python transcribe_video.py
```

This will:
- Show you the current directory
- Ask for the video file path
- Accept various path formats:
  - `video.mp4` (relative path)
  - `/Users/username/Downloads/video.mp4` (full path)
  - `~/Videos/lecture.mp4` (home directory)
  - `./my_video.mp4` (current directory)
- Validate the file exists and is a video
- Guide you through the process

## ✨ Key Features

- **Interactive mode** - Easy file selection with validation
- **No more broken pipe errors** - Smart chunking during silent moments
- **Noise reduction** - Built-in audio cleaning
- **Volume boost** - For quiet recordings
- **Progress tracking** - See real-time progress
- **Multiple languages** - Support for many languages
- **Automatic cleanup** - Removes temporary files
- **Flexible file paths** - Supports relative, absolute, and home directory paths

## 📁 Files Created

- `transcribe_video.py` - Main Python script with interactive mode
- `transcribe.sh` - Bash wrapper for easy use
- `README_USAGE.md` - Detailed usage guide
- `QUICK_START.md` - This file

## 🎉 You're All Set!

The transcriber is ready to handle your video files without the broken pipe issues you were experiencing before. The smart chunking approach ensures reliable transcription even for large files.

**Next step**: Try the interactive mode or specify your video file path! 