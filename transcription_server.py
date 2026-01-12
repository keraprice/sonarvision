#!/usr/bin/env python3
"""
Flask server for handling video transcription requests
Uses the local transcriber instead of OpenAI Whisper API
"""

import os
import tempfile
import subprocess
import json
import time
import threading
from pathlib import Path
from flask import Flask, request, jsonify
from flask_cors import CORS
import uuid
import requests
from queue import Queue
from openai import OpenAI

# Import Prompt Synthesizer API
from prompt_synthesizer_api import prompt_synthesizer_bp
# Import Authentication API
from auth import auth_bp

app = Flask(__name__)
CORS(app)  # Enable CORS for all routes
app.secret_key = os.environ.get('SECRET_KEY', 'dev-secret-key-change-in-production')

# Register blueprints
app.register_blueprint(prompt_synthesizer_bp)
app.register_blueprint(auth_bp)

# Configuration
UPLOAD_FOLDER = 'temp_uploads'
MAX_FILE_SIZE = 100 * 1024 * 1024  # 100MB limit
SUPPORTED_FORMATS = {'.mp4', '.mov', '.avi', '.mkv', '.wmv', '.flv', '.webm', '.m4v'}

# Create upload folder if it doesn't exist
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# Create audio-chunks folder for transcriber
os.makedirs('audio-chunks', exist_ok=True)

# GPT API Queue System
gpt_queue = Queue()
gpt_results = {}
gpt_processing = False
rate_limit_delay = 0
last_heartbeat = time.time()

def process_gpt_queue():
    global gpt_processing, rate_limit_delay, last_heartbeat
    while True:
        try:
            last_heartbeat = time.time()
            if not gpt_queue.empty():
                gpt_processing = True
                request_id, prompt, api_key = gpt_queue.get()
                print(f"Processing request ID: {request_id}")
                
                # Respect rate limiting
                if rate_limit_delay > time.time():
                    time.sleep(rate_limit_delay - time.time())
                
                try:
                    print(f"Making API call for request ID: {request_id}")
                    
                    # Initialize OpenAI client
                    client = OpenAI(api_key=api_key)
                    
                    # Make API call using official client
                    response = client.chat.completions.create(
                        model="gpt-4o",
                        messages=[
                            {
                                'role': 'system',
                                'content': 'You are an expert Business Analyst assistant. Provide clear, actionable, and professional responses to help with business analysis tasks.'
                            },
                            {
                                'role': 'user',
                                'content': prompt
                            }
                        ],
                        max_tokens=1000,
                        temperature=0.7,
                        timeout=15  # 15 second timeout
                    )
                    
                    print(f"API call completed for request ID: {request_id}")
                    
                    # Store successful result
                    gpt_results[request_id] = {
                        'status': 'success',
                        'result': response.choices[0].message.content
                    }
                    print(f"Stored success result for request ID: {request_id}")
                        
                except Exception as e:
                    print(f"Exception in API call for request ID: {request_id}, error: {str(e)}")
                    
                    # Handle specific OpenAI errors
                    if "rate_limit" in str(e).lower() or "429" in str(e):
                        # Rate limited - increase delay and retry
                        rate_limit_delay = time.time() + 60  # 1 minute delay
                        gpt_queue.put((request_id, prompt, api_key))  # Re-queue
                        gpt_results[request_id] = {'status': 'rate_limited', 'retry_after': 60}
                        print(f"Stored rate limit result for request ID: {request_id}")
                    else:
                        gpt_results[request_id] = {'status': 'error', 'error': str(e)}
                        print(f"Stored error result for request ID: {request_id}, error: {str(e)}")
                
                gpt_queue.task_done()
                print(f"Task completed for request ID: {request_id}")
            else:
                gpt_processing = False
                time.sleep(1)  # Check every second
        except Exception as e:
            print(f"Error in GPT queue processor: {e}")
            time.sleep(5)

# Start the GPT queue processor in a background thread
gpt_thread = threading.Thread(target=process_gpt_queue, daemon=True)
gpt_thread.start()

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
        return False

def transcribe_audio(audio_path, noise_reduction=1, volume_boost=None, language="en-EN"):
    """Transcribe audio using the optimized local transcriber"""
    try:
        # Create temporary output file
        output_path = f"temp_transcript_{uuid.uuid4().hex}.txt"
        
        # Ensure audio-chunks directory exists
        os.makedirs('audio-chunks', exist_ok=True)
        
        # Use optimized transcriber with better parameters
        cmd = [
            'python', 'transcriber/transcriber_optimized.py', 
            '-f', audio_path, 
            '-o', output_path, 
            '-nr', str(noise_reduction),
            '-max-chunks', '200',  # Allow up to 200 chunks (about 1 hour of audio)
            '-chunk-duration', '20'  # 20-second chunks
        ]
        
        if volume_boost:
            cmd.extend(['-iv', str(volume_boost)])
        
        if language:
            cmd.extend(['-l', language])
        
        # Run with timeout (30 minutes for longer videos)
        try:
            result = subprocess.run(
                cmd, 
                check=True, 
                cwd=os.getcwd(),
                timeout=1800,  # 30 minute timeout
                capture_output=True,
                text=True
            )
            print(f"[+] Transcription stdout: {result.stdout}")
            if result.stderr:
                print(f"[!] Transcription stderr: {result.stderr}")
        except subprocess.TimeoutExpired:
            print("[-] Transcription timed out after 30 minutes")
            return None
        
        # Read the transcription result
        if os.path.exists(output_path):
            with open(output_path, 'r', encoding='utf-8') as f:
                transcription = f.read()
            
            # Clean up temporary file
            os.remove(output_path)
        else:
            print("[-] Transcription output file not found")
            return None
        
        # Clean up audio-chunks directory if it still exists
        if os.path.exists('audio-chunks'):
            try:
                import shutil
                shutil.rmtree('audio-chunks')
                print("[+] Cleaned up audio-chunks directory")
            except Exception as e:
                print(f"[-] Failed to clean up audio-chunks directory: {e}")
        
        print(f"[+] Transcription completed successfully")
        return transcription
    except subprocess.CalledProcessError as e:
        print(f"[-] Optimized transcriber failed: {e}")
        if e.stdout:
            print(f"[-] stdout: {e.stdout}")
        if e.stderr:
            print(f"[-] stderr: {e.stderr}")
        
        # Try fallback to original transcriber
        print("[!] Trying fallback to original transcriber...")
        try:
            fallback_cmd = [
                'python', 'transcriber/transcriber.py', 
                '-f', audio_path, 
                '-o', output_path, 
                '-nr', str(noise_reduction)
            ]
            
            if volume_boost:
                fallback_cmd.extend(['-iv', str(volume_boost)])
            
            if language:
                fallback_cmd.extend(['-l', language])
            
            result = subprocess.run(
                fallback_cmd, 
                check=True, 
                cwd=os.getcwd(),
                timeout=600,
                capture_output=True,
                text=True
            )
            
            if os.path.exists(output_path):
                with open(output_path, 'r', encoding='utf-8') as f:
                    transcription = f.read()
                os.remove(output_path)
                print(f"[+] Fallback transcription completed successfully")
                return transcription
            else:
                print("[-] Fallback transcription output file not found")
                return None
                
        except Exception as fallback_error:
            print(f"[-] Fallback transcriber also failed: {fallback_error}")
        
        # Clean up audio-chunks directory on error
        if os.path.exists('audio-chunks'):
            try:
                import shutil
                shutil.rmtree('audio-chunks')
                print("[+] Cleaned up audio-chunks directory after error")
            except Exception as cleanup_error:
                print(f"[-] Failed to clean up audio-chunks directory: {cleanup_error}")
        return None
    except Exception as e:
        print(f"[-] Unexpected error: {e}")
        # Clean up audio-chunks directory on error
        if os.path.exists('audio-chunks'):
            try:
                import shutil
                shutil.rmtree('audio-chunks')
                print("[+] Cleaned up audio-chunks directory after error")
            except Exception as cleanup_error:
                print(f"[-] Failed to clean up audio-chunks directory: {cleanup_error}")
        return None

@app.route('/transcribe', methods=['POST'])
def transcribe_video():
    """Handle video transcription requests"""
    try:
        # Check if file was uploaded
        if 'video' not in request.files:
            return jsonify({'error': 'No video file provided'}), 400
        
        file = request.files['video']
        
        if file.filename == '':
            return jsonify({'error': 'No file selected'}), 400
        
        # Check file extension
        file_ext = Path(file.filename).suffix.lower()
        if file_ext not in SUPPORTED_FORMATS:
            return jsonify({
                'error': f'Unsupported file format. Supported formats: {", ".join(SUPPORTED_FORMATS)}'
            }), 400
        
        # Check file size
        file.seek(0, 2)  # Seek to end
        file_size = file.tell()
        file.seek(0)  # Reset to beginning
        
        if file_size > MAX_FILE_SIZE:
            return jsonify({
                'error': f'File too large. Maximum size: {MAX_FILE_SIZE // (1024*1024)}MB'
            }), 400
        
        # Get transcription parameters
        noise_reduction = request.form.get('noise_reduction', 1, type=int)
        volume_boost = request.form.get('volume_boost', type=float)
        language = request.form.get('language', 'en-EN')
        
        # Create temporary files
        video_filename = f"temp_video_{uuid.uuid4().hex}{file_ext}"
        video_path = os.path.join(UPLOAD_FOLDER, video_filename)
        audio_path = os.path.join(UPLOAD_FOLDER, f"temp_audio_{uuid.uuid4().hex}.wav")
        
        try:
            # Save uploaded video
            file.save(video_path)
            print(f"[+] Video saved: {video_path}")
            
            # Extract audio
            if not extract_audio_from_video(video_path, audio_path):
                return jsonify({'error': 'Failed to extract audio from video'}), 500
            
            # Transcribe audio
            transcription = transcribe_audio(audio_path, noise_reduction, volume_boost, language)
            
            if transcription is None:
                return jsonify({'error': 'Transcription failed'}), 500
            
            return jsonify({
                'success': True,
                'transcription': transcription,
                'message': 'Transcription completed successfully'
            })
            
        finally:
            # Clean up temporary files
            for temp_file in [video_path, audio_path]:
                if os.path.exists(temp_file):
                    try:
                        os.remove(temp_file)
                        print(f"[+] Cleaned up: {temp_file}")
                    except Exception as e:
                        print(f"[-] Failed to clean up {temp_file}: {e}")
    
    except Exception as e:
        print(f"[-] Server error: {e}")
        return jsonify({'error': f'Server error: {str(e)}'}), 500

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({'status': 'healthy', 'message': 'Transcription server is running'})

@app.route('/', methods=['GET'])
def index():
    """Root endpoint"""
    return jsonify({
        'message': 'Video Transcription Server',
        'endpoints': {
            'transcribe': '/transcribe (POST)',
            'health': '/health (GET)'
        },
        'supported_formats': list(SUPPORTED_FORMATS),
        'max_file_size_mb': MAX_FILE_SIZE // (1024*1024)
    })

@app.route('/gpt/queue', methods=['POST'])
def queue_gpt_request():
    """Queue a GPT request for processing"""
    try:
        data = request.get_json()
        prompt = data.get('prompt')
        api_key = data.get('api_key')
        
        if not prompt or not api_key:
            return jsonify({'error': 'Missing prompt or api_key'}), 400
        
        # Generate unique request ID
        request_id = str(uuid.uuid4())
        print(f"Queuing request with ID: {request_id}")
        
        # Add to queue
        gpt_queue.put((request_id, prompt, api_key))
        print(f"Queue size after adding: {gpt_queue.qsize()}")
        
        return jsonify({
            'request_id': request_id,
            'status': 'queued',
            'queue_position': gpt_queue.qsize()
        })
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/gpt/status/<request_id>', methods=['GET'])
def get_gpt_status(request_id):
    """Check the status of a queued GPT request"""
    try:
        if request_id not in gpt_results:
            return jsonify({'status': 'not_found'}), 404
        
        result = gpt_results[request_id]
        
        # Clean up completed results after 1 hour
        if result['status'] in ['success', 'error']:
            threading.Timer(3600, lambda: gpt_results.pop(request_id, None)).start()
        
        return jsonify(result)
        
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/gpt/queue/status', methods=['GET'])
def get_queue_status():
    """Get overall queue status"""
    try:
        return jsonify({
            'queue_size': gpt_queue.qsize(),
            'processing': gpt_processing,
            'rate_limit_delay': max(0, rate_limit_delay - time.time()),
            'available_results': list(gpt_results.keys())
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/gpt/queue/debug', methods=['GET'])
def debug_queue():
    """Debug queue information"""
    try:
        return jsonify({
            'queue_size': gpt_queue.qsize(),
            'processing': gpt_processing,
            'rate_limit_delay': rate_limit_delay,
            'current_time': time.time(),
            'last_heartbeat': last_heartbeat,
            'heartbeat_age': time.time() - last_heartbeat,
            'available_results': list(gpt_results.keys()),
            'queue_items': list(gpt_queue.queue) if hasattr(gpt_queue, 'queue') else 'No queue access'
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/gpt/test/success', methods=['POST'])
def test_success_result():
    """Test endpoint to create a mock successful result"""
    try:
        data = request.get_json()
        request_id = data.get('request_id', str(uuid.uuid4()))
        test_response = data.get('response', 'This is a test response from GPT. The result display functionality is working correctly!')
        
        gpt_results[request_id] = {
            'status': 'success',
            'result': test_response
        }
        
        return jsonify({
            'request_id': request_id,
            'status': 'success',
            'result': test_response
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    print("🎬 Starting Video Transcription Server...")
    print(f"📁 Upload folder: {UPLOAD_FOLDER}")
    print(f"📏 Max file size: {MAX_FILE_SIZE // (1024*1024)}MB")
    print(f"🎵 Supported formats: {', '.join(SUPPORTED_FORMATS)}")
    print("🚀 Server running on http://localhost:5001")
    print("📋 Health check: http://localhost:5001/health")
    print("🤖 GPT Queue: http://localhost:5001/gpt/queue")
    
    app.run(host='0.0.0.0', port=5001, debug=True)
