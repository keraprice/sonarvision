#!/usr/bin/env python3
"""
Video Transcription Script using mirawara/transcriber
This script extracts audio from video files and transcribes them using the robust transcriber.
"""

import os
import sys
import subprocess
import argparse
from pathlib import Path

def extract_audio_from_video(video_path, audio_path):
    """Extract audio from video using ffmpeg"""
    try:
        cmd = [
            'ffmpeg', '-i', video_path, 
            '-vn', '-acodec', 'pcm_s16le', 
            '-ar', '44100', '-ac', '2', 
            '-y', audio_path
        ]
        subprocess.run(cmd, check=True, capture_output=True)
        print(f"[+] Audio extracted to: {audio_path}")
        return True
    except subprocess.CalledProcessError as e:
        print(f"[-] Error extracting audio: {e}")
        return False
    except FileNotFoundError:
        print("[-] ffmpeg not found. Please install ffmpeg first.")
        print("   macOS: brew install ffmpeg")
        print("   Ubuntu: sudo apt install ffmpeg")
        return False

def transcribe_audio(audio_path, output_path, noise_reduction=1, volume_boost=None, language="en-EN"):
    """Transcribe audio using the mirawara transcriber"""
    try:
        cmd = ['python', 'transcriber.py', '-f', audio_path, '-o', output_path, '-nr', str(noise_reduction)]
        
        if volume_boost:
            cmd.extend(['-iv', str(volume_boost)])
        
        if language:
            cmd.extend(['-l', language])
        
        subprocess.run(cmd, check=True)
        print(f"[+] Transcription completed: {output_path}")
        return True
    except subprocess.CalledProcessError as e:
        print(f"[-] Error during transcription: {e}")
        return False

def get_video_path():
    """Get video file path from user input"""
    while True:
        print("\n" + "="*60)
        print("🎬 VIDEO TRANSCRIPTION TOOL")
        print("="*60)
        
        # Show current directory
        current_dir = Path.cwd()
        print(f"Current directory: {current_dir}")
        
        # Ask for file path
        print("\nEnter the path to your video file:")
        print("Examples:")
        print("  - Relative path: video.mp4")
        print("  - Full path: /Users/username/Downloads/video.mp4")
        print("  - Home directory: ~/Videos/lecture.mp4")
        print("  - Current directory: ./my_video.mp4")
        print("\nOr type 'quit' to exit")
        
        file_path = input("\n📁 Video file path: ").strip()
        
        if file_path.lower() in ['quit', 'exit', 'q']:
            print("Goodbye!")
            sys.exit(0)
        
        if not file_path:
            print("[-] Please enter a file path")
            continue
        
        # Expand user path (~) and resolve relative paths
        try:
            expanded_path = Path(file_path).expanduser().resolve()
        except Exception as e:
            print(f"[-] Invalid path: {e}")
            continue
        
        # Check if file exists
        if not expanded_path.exists():
            print(f"[-] File not found: {expanded_path}")
            print("   Please check the path and try again")
            continue
        
        # Check if it's a file (not directory)
        if not expanded_path.is_file():
            print(f"[-] Path is not a file: {expanded_path}")
            continue
        
        # Check if it's a video file
        video_extensions = {'.mp4', '.mov', '.avi', '.mkv', '.wmv', '.flv', '.webm', '.m4v'}
        if expanded_path.suffix.lower() not in video_extensions:
            print(f"[-] File doesn't appear to be a video: {expanded_path}")
            print(f"   Supported formats: {', '.join(video_extensions)}")
            continue
        
        print(f"[+] Found video file: {expanded_path}")
        return expanded_path

def main():
    parser = argparse.ArgumentParser(description="Transcribe video files using mirawara/transcriber")
    parser.add_argument("video_file", nargs='?', help="Path to video file (optional - will prompt if not provided)")
    parser.add_argument("-o", "--output", help="Output transcript file (default: video_name_transcript.txt)")
    parser.add_argument("-nr", "--noise-reduction", type=int, choices=[1, 2], default=1,
                       help="Noise reduction level: 1=Basic (recommended), 2=Massive")
    parser.add_argument("-iv", "--increase-volume", type=float, 
                       help="Volume boost (0.1 to 3.0)")
    parser.add_argument("-l", "--language", default="en-EN",
                       help="Language code (default: en-EN)")
    parser.add_argument("--keep-audio", action="store_true",
                       help="Keep extracted audio file")
    parser.add_argument("--interactive", action="store_true",
                       help="Force interactive mode to select video file")
    
    args = parser.parse_args()
    
    # Get video file path
    if args.interactive or not args.video_file:
        video_path = get_video_path()
    else:
        # Validate provided file path
        video_path = Path(args.video_file).expanduser().resolve()
        if not video_path.exists():
            print(f"[-] Error: Video file not found: {video_path}")
            print("   Try running without arguments for interactive mode")
            sys.exit(1)
        if not video_path.is_file():
            print(f"[-] Error: Path is not a file: {video_path}")
            sys.exit(1)
    
    # Set output path
    if args.output:
        output_path = args.output
    else:
        output_path = video_path.stem + "_transcript.txt"
    
    # Extract audio
    audio_path = video_path.stem + "_audio.wav"
    print(f"\n[+] Processing video: {video_path}")
    
    if not extract_audio_from_video(str(video_path), audio_path):
        sys.exit(1)
    
    # Transcribe audio
    print(f"[+] Starting transcription...")
    if not transcribe_audio(audio_path, output_path, args.noise_reduction, args.increase_volume, args.language):
        sys.exit(1)
    
    # Cleanup
    if not args.keep_audio:
        os.remove(audio_path)
        print(f"[+] Cleaned up temporary audio file")
    
    print(f"[+] Success! Transcript saved to: {output_path}")
    
    # Show preview
    try:
        with open(output_path, 'r') as f:
            content = f.read()
            print(f"\n[+] Preview (first 200 characters):")
            print("-" * 50)
            print(content[:200] + "..." if len(content) > 200 else content)
            print("-" * 50)
    except Exception as e:
        print(f"[-] Could not read transcript file: {e}")

if __name__ == "__main__":
    main() 