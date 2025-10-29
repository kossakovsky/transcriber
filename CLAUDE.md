# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Node.js project for automated video transcription using ElevenLabs Scribe API. The project processes videos through a three-stage pipeline:

1. **Video** → Extract audio from video files
2. **Audio** → Transcribe audio using ElevenLabs Scribe API
3. **Text** → Save transcription results

## Environment Setup

**Required**: Create a `.env` file with:
```
ELEVENLABS_API_KEY=your_api_key_here
```

Get your API key from: https://elevenlabs.io/app/speech-to-text

## Running the Main Script

```bash
# Install dependencies
npm install

# Run the complete pipeline
npm run process
# or
node process.js
```

## Folder Structure

The project uses three main folders (all added to .gitignore):

- **video/** - Place your video files here (.mp4, .mov)
- **audio/** - Extracted audio files in MP3 format (auto-generated)
- **text/** - Transcription results in .txt format (auto-generated)

## Architecture

### process.js (Main Script)

**Workflow**:
1. Scans `video/` folder for .mp4 and .mov files
2. Extracts audio from each video → saves as MP3 in `audio/`
3. Transcribes each audio file → saves transcript in `text/`
4. Automatically skips already processed files (checks for existing .txt files)

**Key Features**:
- **Smart file handling**: Processes only new videos (skips if .txt already exists)
- **Large file support**: Handles files up to 3GB and 10 hours duration
- **MP3 format**: Extracts audio as compressed MP3 (much smaller than WAV)
- **Speaker diarization**: Automatically identifies different speakers in the audio
- **Robust error handling**: Continues processing remaining files if one fails
- **Russian language**: Transcription configured for Russian ("ru")
- **High accuracy**: Uses ElevenLabs Scribe v1 model (best-in-class accuracy)

**Configuration**:
- Supported video formats: `.mp4`, `.mov` (line 30)
- Audio format: MP3 with libmp3lame codec
- File size limit: 3GB (ElevenLabs limit)
- Duration limit: 10 hours (ElevenLabs limit)
- API timeout: 20 minutes for large files

### Legacy Scripts

- **transcribe.js** - Original script for transcribing audio files with hardcoded file paths
- **roleplay.js** - Speaker role identification using GPT-4o (not integrated into main pipeline)

These are kept for reference and can be used independently if needed.

## Dependencies

- **axios** - HTTP client for OpenAI API calls
- **dotenv** - Environment variable management
- **fluent-ffmpeg** - FFmpeg wrapper for audio/video processing
- **@ffmpeg-installer/ffmpeg** - Bundled FFmpeg binary
- **form-data** - Multipart form data for file uploads

## Usage Example

```bash
# 1. Place video files in video/ folder
cp /path/to/your/video.mp4 ./video/

# 2. Run processing
npm run process

# 3. Find transcription in text/ folder
cat ./text/video.txt
```

## Language Settings

To change transcription language from Russian:
- Modify `language_code` parameter in process.js at line 127
- ElevenLabs Scribe supports 99 languages
- Supported languages: https://elevenlabs.io/docs/capabilities/speech-to-text

## Error Handling

The script implements comprehensive error handling:
- Skips files that fail and continues with remaining files
- Validates file size (max 3GB) and duration (max 10 hours) before processing
- Logs detailed error information (API status, network errors, etc.)
- Won't re-process successfully completed files

## API Pricing

ElevenLabs Scribe pricing:
- Starting from $0.40 per hour of transcribed audio
- Lower rates available at scale with Enterprise plans
- More info: https://elevenlabs.io/speech-to-text
