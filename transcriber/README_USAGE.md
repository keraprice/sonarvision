# Video Transcription Tool

This tool uses the [mirawara/transcriber](https://github.com/mirawara/transcriber) project to transcribe video files with robust chunking and noise reduction.

## Features

- **Smart chunking**: Splits audio during silent moments to prevent broken pipe errors
- **Noise reduction**: Built-in noise reduction capabilities (basic and massive)
- **Volume adjustment**: Can boost volume for better recognition
- **Progress tracking**: Shows real-time progress
- **Multiple languages**: Supports various language codes
- **Automatic cleanup**: Removes temporary files

## Prerequisites

1. **ffmpeg** (for audio extraction):
   ```bash
   # macOS
   brew install ffmpeg
   
   # Ubuntu/Debian
   sudo apt install ffmpeg
   ```

2. **Python dependencies** (already installed):
   ```bash
   pip install noisereduce numpy SpeechRecognition pydub scipy tqdm
   ```

## Usage

### Basic Usage
```bash
python transcribe_video.py your_video.mp4
```

### Advanced Options
```bash
python transcribe_video.py your_video.mp4 \
  -o custom_output.txt \
  -nr 2 \
  -iv 1.5 \
  -l en-US \
  --keep-audio
```

### Parameters

- `video_file`: Path to your video file (required)
- `-o, --output`: Output transcript file (default: video_name_transcript.txt)
- `-nr, --noise-reduction`: Noise reduction level
  - `1`: Basic noise reduction (recommended)
  - `2`: Massive noise reduction (for very noisy audio)
- `-iv, --increase-volume`: Volume boost (0.1 to 3.0)
- `-l, --language`: Language code (default: en-EN)
- `--keep-audio`: Keep the extracted audio file

### Language Codes

Common language codes:
- `en-EN`: English (UK)
- `en-US`: English (US)
- `es-ES`: Spanish
- `fr-FR`: French
- `de-DE`: German
- `it-IT`: Italian
- `pt-BR`: Portuguese (Brazil)
- `ja-JP`: Japanese
- `ko-KR`: Korean
- `zh-CN`: Chinese (Simplified)

## Examples

### Transcribe with basic settings
```bash
python transcribe_video.py lecture.mp4
```

### Transcribe noisy audio with volume boost
```bash
python transcribe_video.py noisy_recording.mp4 -nr 2 -iv 2.0
```

### Transcribe in Spanish
```bash
python transcribe_video.py spanish_video.mp4 -l es-ES
```

### Keep the extracted audio file
```bash
python transcribe_video.py video.mp4 --keep-audio
```

## Troubleshooting

### "ffmpeg not found"
Install ffmpeg using the commands above.

### Poor transcription quality
1. Try noise reduction level 2: `-nr 2`
2. Increase volume: `-iv 1.5` or `-iv 2.0`
3. Ensure the audio is clear and not too quiet

### Large files
The transcriber automatically handles large files by splitting them into chunks during silent moments.

### Network issues
The tool uses Google Speech Recognition API, so it requires an internet connection.

## Tips

1. **For best results**: Use clear audio with minimal background noise
2. **For noisy recordings**: Use `-nr 2` for massive noise reduction
3. **For quiet recordings**: Use `-iv 1.5` to boost volume
4. **For different accents**: Try different language codes (e.g., `en-US` vs `en-EN`)

## Output

The script will:
1. Extract audio from your video
2. Split it into chunks during silent moments
3. Transcribe each chunk using Google Speech Recognition
4. Combine all transcriptions into a single text file
5. Show a preview of the result
6. Clean up temporary files (unless `--keep-audio` is used) 