#!/usr/bin/env python3
"""
Enhanced Video Transcription Script for Large Files
This script provides better control over chunking for very large video files.
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

def get_file_size_mb(file_path):
    """Get file size in MB"""
    size_bytes = os.path.getsize(file_path)
    return size_bytes / (1024 * 1024)

def estimate_duration_minutes(file_path):
    """Estimate audio duration using ffprobe"""
    try:
        cmd = [
            'ffprobe', '-v', 'quiet', '-show_entries', 'format=duration',
            '-of', 'csv=p=0', file_path
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        duration_seconds = float(result.stdout.strip())
        return duration_seconds / 60
    except:
        return None

def recommend_chunking_strategy(file_path):
    """Recommend chunking strategy based on file size and duration"""
    size_mb = get_file_size_mb(file_path)
    duration_min = estimate_duration_minutes(file_path)
    
    print(f"[+] File size: {size_mb:.1f} MB")
    if duration_min:
        print(f"[+] Estimated duration: {duration_min:.1f} minutes")
    
    if size_mb > 100 or (duration_min and duration_min > 60):
        print("[+] Large file detected! Recommending aggressive chunking...")
        return {
            'min_silence_len': 800,  # Shorter silence detection
            'silence_thresh': -20,   # More sensitive to silence
            'keep_silence': 500,     # Less silence kept
            'max_chunk_duration': 300  # Max 5 minutes per chunk
        }
    elif size_mb > 50 or (duration_min and duration_min > 30):
        print("[+] Medium file detected! Using balanced chunking...")
        return {
            'min_silence_len': 1000,
            'silence_thresh': -16,
            'keep_silence': 800,
            'max_chunk_duration': 600  # Max 10 minutes per chunk
        }
    else:
        print("[+] Small file detected! Using standard chunking...")
        return {
            'min_silence_len': 1200,
            'silence_thresh': -14,
            'keep_silence': 1000,
            'max_chunk_duration': None
        }

def transcribe_with_custom_chunking(audio_path, output_path, chunking_params, noise_reduction=1, volume_boost=None, language="en-EN"):
    """Transcribe audio with custom chunking parameters"""
    try:
        # Create a temporary script with custom chunking
        temp_script = "temp_transcriber.py"
        
        with open("transcriber.py", 'r') as f:
            transcriber_code = f.read()
        
        # Modify the chunking parameters
        modified_code = transcriber_code.replace(
            "chunks = split_on_silence(\n        sound, min_silence_len=1200, silence_thresh=sound.dBFS - 14, keep_silence=1000)",
            f"chunks = split_on_silence(\n        sound, min_silence_len={chunking_params['min_silence_len']}, silence_thresh=sound.dBFS {chunking_params['silence_thresh']}, keep_silence={chunking_params['keep_silence']})"
        )
        
        with open(temp_script, 'w') as f:
            f.write(modified_code)
        
        # Run the modified transcriber
        cmd = ['python', temp_script, '-f', audio_path, '-o', output_path, '-nr', str(noise_reduction)]
        
        if volume_boost:
            cmd.extend(['-iv', str(volume_boost)])
        
        if language:
            cmd.extend(['-l', language])
        
        subprocess.run(cmd, check=True)
        
        # Cleanup
        os.remove(temp_script)
        
        print(f"[+] Transcription completed: {output_path}")
        return True
    except subprocess.CalledProcessError as e:
        print(f"[-] Error during transcription: {e}")
        return False

def get_video_path():
    """Get video file path from user input"""
    while True:
        print("\n" + "="*60)
        print("🎬 LARGE FILE VIDEO TRANSCRIPTION TOOL")
        print("="*60)
        
        current_dir = Path.cwd()
        print(f"Current directory: {current_dir}")
        
        print("\nEnter the path to your video file:")
        print("Examples:")
        print("  - Relative path: video.mp4")
        print("  - Full path: /Users/username/Downloads/video.mp4")
        print("  - Home directory: ~/Videos/lecture.mp4")
        print("\nOr type 'quit' to exit")
        
        file_path = input("\n📁 Video file path: ").strip()
        
        if file_path.lower() in ['quit', 'exit', 'q']:
            print("Goodbye!")
            sys.exit(0)
        
        if not file_path:
            print("[-] Please enter a file path")
            continue
        
        try:
            expanded_path = Path(file_path).expanduser().resolve()
        except Exception as e:
            print(f"[-] Invalid path: {e}")
            continue
        
        if not expanded_path.exists():
            print(f"[-] File not found: {expanded_path}")
            continue
        
        if not expanded_path.is_file():
            print(f"[-] Path is not a file: {expanded_path}")
            continue
        
        video_extensions = {'.mp4', '.mov', '.avi', '.mkv', '.wmv', '.flv', '.webm', '.m4v'}
        if expanded_path.suffix.lower() not in video_extensions:
            print(f"[-] File doesn't appear to be a video: {expanded_path}")
            continue
        
        print(f"[+] Found video file: {expanded_path}")
        return expanded_path

def main():
    parser = argparse.ArgumentParser(description="Enhanced video transcription for large files")
    parser.add_argument("video_file", nargs='?', help="Path to video file (optional - will prompt if not provided)")
    parser.add_argument("-o", "--output", help="Output transcript file")
    parser.add_argument("-nr", "--noise-reduction", type=int, choices=[1, 2], default=1,
                       help="Noise reduction level: 1=Basic, 2=Massive")
    parser.add_argument("-iv", "--increase-volume", type=float, 
                       help="Volume boost (0.1 to 3.0)")
    parser.add_argument("-l", "--language", default="en-EN",
                       help="Language code (default: en-EN)")
    parser.add_argument("--keep-audio", action="store_true",
                       help="Keep extracted audio file")
    parser.add_argument("--aggressive-chunking", action="store_true",
                       help="Force aggressive chunking for very large files")
    parser.add_argument("--interactive", action="store_true",
                       help="Force interactive mode")
    
    args = parser.parse_args()
    
    # Get video file path
    if args.interactive or not args.video_file:
        video_path = get_video_path()
    else:
        video_path = Path(args.video_file).expanduser().resolve()
        if not video_path.exists():
            print(f"[-] Error: Video file not found: {video_path}")
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
    
    # Determine chunking strategy
    if args.aggressive_chunking:
        chunking_params = {
            'min_silence_len': 600,   # Very aggressive
            'silence_thresh': -25,    # Very sensitive
            'keep_silence': 300,      # Minimal silence
            'max_chunk_duration': 180  # Max 3 minutes
        }
        print("[+] Using aggressive chunking strategy")
    else:
        chunking_params = recommend_chunking_strategy(audio_path)
    
    # Transcribe audio
    print(f"[+] Starting transcription with optimized chunking...")
    if not transcribe_with_custom_chunking(audio_path, output_path, chunking_params, 
                                          args.noise_reduction, args.increase_volume, args.language):
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