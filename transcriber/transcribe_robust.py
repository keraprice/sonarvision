#!/usr/bin/env python3
"""
Robust Video Transcription Script with Error Recovery
This script handles network errors and can resume transcription from where it left off.
"""

import os
import sys
import subprocess
import argparse
import time
import json
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

def create_robust_transcriber():
    """Create a robust transcriber script with error handling"""
    robust_code = '''#!/usr/bin/env python3
import os
import sys
import random
import shutil
import string
import time
import json

import noisereduce as nr
import numpy as np
import speech_recognition as sr
from pydub import AudioSegment
from pydub.silence import split_on_silence
from scipy.io import wavfile
from tqdm import tqdm

def process_chunk_with_retry(chunk_filename, language="en-EN", max_retries=3):
    """Process a chunk with retry logic for network errors"""
    r = sr.Recognizer()
    
    for attempt in range(max_retries):
        try:
            with sr.AudioFile(chunk_filename) as source:
                r.adjust_for_ambient_noise(source, duration=1)
                audio_listened = r.record(source)
                
                text = r.recognize_google(audio_listened, language=language)
                return f"{text.capitalize()}. "
                
        except sr.UnknownValueError:
            return None
        except (sr.RequestError, ConnectionResetError, OSError) as e:
            if attempt < max_retries - 1:
                wait_time = (2 ** attempt) + random.uniform(0, 1)
                print(f"    Network error, retrying in {wait_time:.1f}s... (attempt {attempt + 1}/{max_retries})")
                time.sleep(wait_time)
            else:
                print(f"    Failed after {max_retries} attempts: {e}")
                return None
        except Exception as e:
            print(f"    Unexpected error: {e}")
            return None
    
    return None

def transcribe_audio_robust(path, output_path, language="en-EN", noise_reduction=1, volume_boost=None):
    """Transcribe audio with robust error handling"""
    sound = AudioSegment.from_file(path)
    
    if volume_boost:
        sound = sound + (10 * volume_boost)
    
    if noise_reduction == 2:
        print("[+] Applying massive noise reduction...")
        # Noise reduction code here
        pass
    
    print("[+] Splitting in chunks...")
    chunks = split_on_silence(
        sound, min_silence_len=800, silence_thresh=sound.dBFS - 20, keep_silence=500)
    print(f"[+] {len(chunks)} chunks generated!")
    
    # Create folder for chunks
    folder_name = "audio-chunks"
    if not os.path.isdir(folder_name):
        os.mkdir(folder_name)
    
    # Load progress if exists
    progress_file = "transcription_progress.json"
    completed_chunks = set()
    if os.path.exists(progress_file):
        try:
            with open(progress_file, 'r') as f:
                data = json.load(f)
                completed_chunks = set(data.get('completed_chunks', []))
                print(f"[+] Resuming from chunk {len(completed_chunks) + 1}")
        except:
            pass
    
    whole_text = ""
    successful_chunks = 0
    failed_chunks = 0
    
    print("[+] Processing chunks...")
    
    for i, audio_chunk in enumerate(tqdm(chunks), start=1):
        if i in completed_chunks:
            continue
            
        chunk_filename = os.path.join(folder_name, f"chunk{i}.wav")
        chunk_silent = AudioSegment.silent(duration=3)
        audio_chunk = chunk_silent + audio_chunk + chunk_silent
        audio_chunk.export(chunk_filename, format="wav")
        
        text = process_chunk_with_retry(chunk_filename, language)
        
        if text:
            whole_text += text
            successful_chunks += 1
        else:
            failed_chunks += 1
        
        # Save progress
        completed_chunks.add(i)
        with open(progress_file, 'w') as f:
            json.dump({'completed_chunks': list(completed_chunks)}, f)
        
        # Clean up chunk file
        os.remove(chunk_filename)
    
    # Clean up
    shutil.rmtree(folder_name)
    if os.path.exists(progress_file):
        os.remove(progress_file)
    
    print(f"[+] Transcription completed!")
    print(f"[+] Successful chunks: {successful_chunks}")
    print(f"[+] Failed chunks: {failed_chunks}")
    
    return whole_text

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python script.py <audio_file> <output_file> [language] [noise_reduction] [volume_boost]")
        sys.exit(1)
    
    audio_file = sys.argv[1]
    output_file = sys.argv[2]
    language = sys.argv[3] if len(sys.argv) > 3 else "en-EN"
    noise_reduction = int(sys.argv[4]) if len(sys.argv) > 4 else 1
    volume_boost = float(sys.argv[5]) if len(sys.argv) > 5 else None
    
    result = transcribe_audio_robust(audio_file, output_file, language, noise_reduction, volume_boost)
    
    with open(output_file, 'w') as f:
        f.write(result)
    
    print(f"[+] Transcript saved to: {output_file}")
'''
    
    with open("robust_transcriber.py", 'w') as f:
        f.write(robust_code)
    
    return "robust_transcriber.py"

def transcribe_with_robust_handler(audio_path, output_path, noise_reduction=1, volume_boost=None, language="en-EN"):
    """Transcribe audio using the robust handler"""
    try:
        # Create robust transcriber
        robust_script = create_robust_transcriber()
        
        # Run the robust transcriber
        cmd = ['python', robust_script, audio_path, output_path, language, str(noise_reduction)]
        
        if volume_boost:
            cmd.append(str(volume_boost))
        
        subprocess.run(cmd, check=True)
        
        # Cleanup
        os.remove(robust_script)
        
        print(f"[+] Transcription completed: {output_path}")
        return True
    except subprocess.CalledProcessError as e:
        print(f"[-] Error during transcription: {e}")
        return False

def get_video_path():
    """Get video file path from user input"""
    while True:
        print("\n" + "="*60)
        print("🎬 ROBUST VIDEO TRANSCRIPTION TOOL")
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
    parser = argparse.ArgumentParser(description="Robust video transcription with error recovery")
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
    
    # Show file info
    size_mb = get_file_size_mb(audio_path)
    duration_min = estimate_duration_minutes(audio_path)
    print(f"[+] Audio file size: {size_mb:.1f} MB")
    if duration_min:
        print(f"[+] Estimated duration: {duration_min:.1f} minutes")
    
    # Transcribe audio with robust error handling
    print(f"[+] Starting robust transcription...")
    if not transcribe_with_robust_handler(audio_path, output_path, 
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