import argparse
import os
import random
import shutil
import string
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import noisereduce as nr
import numpy as np
import speech_recognition as sr
from pydub import AudioSegment
from pydub.silence import split_on_silence
from scipy.io import wavfile
from tqdm import tqdm


def get_args():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "-f", "--file", help="Path to audio file", dest="file", required=True)
    parser.add_argument("-nr", "--noise-reduction", dest="noise", help="Noise reduction:\n" +
                                                                       "    there are two levels:\n" +
                                                                       "        level 1 - Basic noise reduction (recommended)\n" +
                                                                       "        level 2 - Massive noise reduction\n"
                        )
    parser.add_argument(
        "-o", "--output", help="Path to output file", dest="out", required=True)
    parser.add_argument("-iv", "--increase-volume", dest="iv", help="Increase volume:\n" +
                                                                    "    you have to provide a float " +
                                                                    "from 0 to 3 in the form int.dec")
    parser.add_argument("-l", "--language", dest="lang", help="Language (Default: en-EN)")
    parser.add_argument("-max-chunks", "--max-chunks", dest="max_chunks", type=int, 
                       default=200, help="Maximum number of chunks to process (Default: 200)")
    parser.add_argument("-chunk-duration", "--chunk-duration", dest="chunk_duration", type=int,
                       default=20, help="Maximum chunk duration in seconds (Default: 20)")

    return parser.parse_args()


folder_name = "audio-chunks"
args = get_args()

# Speech recognition object
r = sr.Recognizer()

# Configure speech recognition for better performance
r.energy_threshold = 300  # Lower threshold for better detection
r.dynamic_energy_threshold = True
r.pause_threshold = 0.8  # Shorter pause threshold


def massive_noisereduction(audio_file):
    print("[+] Starting massive noise reduction...")

    # Random name for the new file
    random_string = ''.join(random.choices(
        string.ascii_letters + string.digits, k=8))
    file_name = random_string + '.wav'
    audio_file.export(file_name, format='wav')

    # Noise reduction
    rate, data = wavfile.read(file_name)
    orig_shape = data.shape
    data = np.reshape(data, (2, -1))
    reduced_noise = nr.reduce_noise(
        y=data, sr=rate, n_jobs=-1, stationary=True)

    # cleanup
    os.remove(file_name)

    file_name = "reduced_" + file_name
    wavfile.write(file_name, rate,
                  reduced_noise.reshape(orig_shape))
    sound = AudioSegment.from_file(file_name)

    # cleanup
    os.remove(file_name)

    print("[+] Noise reduction completed! :D")
    return sound


def increase_volume(sound, level):
    print("[+] Increasing volume...")
    sound = sound + 10 * level
    print("[+] Volume increased! :D")
    return sound


def process_chunk_with_retry(chunk_filename, max_retries=3):
    """Process a single chunk with retry logic"""
    for attempt in range(max_retries):
        try:
            with sr.AudioFile(chunk_filename) as source:
                if args.noise and args.noise == "1":
                    # Noise reduction
                    r.adjust_for_ambient_noise(source, duration=1)  # Reduced duration

                audio_listened = r.record(source)
                
                # Convert to text
                language = args.lang if args.lang else "en-EN"
                text = r.recognize_google(audio_listened, language=language)
                
                if text:
                    return f"{text.capitalize()}. "
                return ""
                
        except sr.UnknownValueError:
            # Speech was unintelligible
            return ""
        except sr.RequestError as e:
            if attempt < max_retries - 1:
                print(f"[!] Request error on attempt {attempt + 1}, retrying in 2 seconds...")
                time.sleep(2)
                continue
            else:
                print(f"[-] Failed to process chunk after {max_retries} attempts: {e}")
                return ""
        except Exception as e:
            if attempt < max_retries - 1:
                print(f"[!] Error on attempt {attempt + 1}, retrying in 1 second...")
                time.sleep(1)
                continue
            else:
                print(f"[-] Failed to process chunk after {max_retries} attempts: {e}")
                return ""
    
    return ""


def transcribe_audio(path):
    sound = AudioSegment.from_file(path)

    if args.iv:
        k = float(args.iv)
        if k <= 3 and k > 0:
            sound = increase_volume(sound, float(k))
        else:
            print("Bro, read the instructions!")
            sys.exit()

    if args.noise and int(args.noise) == 2:
        sound = massive_noisereduction(sound)

    print("[+] Splitting in chunks...")

    # More aggressive chunking for better performance
    chunks = split_on_silence(
        sound, 
        min_silence_len=800,  # Reduced from 1200ms
        silence_thresh=sound.dBFS - 16,  # More sensitive
        keep_silence=500  # Reduced from 1000ms
    )
    
    # Limit chunk duration to prevent very long chunks
    max_chunk_duration = args.chunk_duration * 1000  # Convert to milliseconds
    limited_chunks = []
    
    for chunk in chunks:
        if len(chunk) > max_chunk_duration:
            # Split long chunks into smaller pieces
            num_splits = (len(chunk) // max_chunk_duration) + 1
            split_duration = len(chunk) // num_splits
            
            for i in range(num_splits):
                start_time = i * split_duration
                end_time = min((i + 1) * split_duration, len(chunk))
                limited_chunks.append(chunk[start_time:end_time])
        else:
            limited_chunks.append(chunk)
    
    chunks = limited_chunks
    
    # Only limit chunks if there are way too many (more than 500)
    if len(chunks) > 500:
        print(f"[!] Limiting chunks from {len(chunks)} to 500 for performance (very long video)")
        chunks = chunks[:500]
    
    print(f"[+] {len(chunks)} chunks generated! :D")
    
    # Calculate estimated duration
    total_duration_seconds = sum(len(chunk) for chunk in chunks) / 1000
    print(f"[+] Estimated audio duration: {total_duration_seconds:.1f} seconds ({total_duration_seconds/60:.1f} minutes)")

    # Create folder to store audio chunks
    if not os.path.isdir(folder_name):
        os.mkdir(folder_name)

    whole_text = ""
    processed_chunks = 0

    print("[+] Processing chunks...")

    # Process chunks with threading for better performance
    def process_single_chunk(chunk_data):
        i, audio_chunk = chunk_data
        
        # Export chunk and save in folder
        chunk_filename = os.path.join(folder_name, f"chunk{i}.wav")
        chunk_silent = AudioSegment.silent(duration=2)  # Reduced from 5 seconds
        audio_chunk = chunk_silent + audio_chunk + chunk_silent
        audio_chunk.export(chunk_filename, format="wav")

        # Recognize chunk
        text = process_chunk_with_retry(chunk_filename)
        
        # Clean up chunk file immediately
        try:
            os.remove(chunk_filename)
        except:
            pass
            
        return text

    # Use ThreadPoolExecutor for parallel processing
    with ThreadPoolExecutor(max_workers=3) as executor:  # Limit to 3 workers to avoid overwhelming the API
        # Submit all chunks
        future_to_chunk = {
            executor.submit(process_single_chunk, (i+1, chunk)): i 
            for i, chunk in enumerate(chunks)
        }
        
        # Process results as they complete
        results = [""] * len(chunks)
        for future in tqdm(as_completed(future_to_chunk), total=len(chunks), desc="Processing chunks"):
            chunk_index = future_to_chunk[future]
            try:
                text = future.result()
                results[chunk_index] = text
                processed_chunks += 1
                
                # Show progress every 10 chunks
                if processed_chunks % 10 == 0:
                    print(f"[+] Progress: {processed_chunks}/{len(chunks)} chunks completed")
                    
            except Exception as e:
                print(f"[-] Error processing chunk {chunk_index + 1}: {e}")
                results[chunk_index] = ""

    # Combine results in order
    whole_text = "".join(results)

    print(f"[+] Transcription completed! Processed {processed_chunks}/{len(chunks)} chunks successfully")

    # cleanup
    if os.path.exists(folder_name):
        shutil.rmtree(folder_name)

    # Return text for all chunks
    return whole_text


if __name__ == "__main__":
    result = transcribe_audio(args.file)
    print(result, file=open(args.out, 'w'))
