# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Node.js project for automated video transcription using OpenAI's Whisper API. The project processes videos through a three-stage pipeline:

1. **Video** → Extract audio from video files
2. **Audio** → Transcribe audio using OpenAI Whisper API
3. **Text** → Save transcription results

## Environment Setup

**Required**: Create a `.env` file with:
```
OPENAI_API_KEY=your_api_key_here
```

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
- **audio/** - Extracted audio files in WAV format (auto-generated)
- **text/** - Transcription results in .txt format (auto-generated)

## Architecture

### process.js (Main Script)

**Workflow**:
1. Scans `video/` folder for .mp4 and .mov files
2. Extracts audio from each video → saves as WAV in `audio/`
3. Transcribes each audio file → saves transcript in `text/`
4. Automatically skips already processed files (checks for existing .txt files)

**Key Features**:
- **Smart file handling**: Processes only new videos (skips if .txt already exists)
- **Large file support**: Automatically splits audio files >25MB into chunks
- **WAV format**: Extracts audio as uncompressed WAV for best transcription quality
- **Chunk processing**: Each chunk transcribed separately, results concatenated
- **Robust error handling**: Continues processing remaining files if one fails
- **Automatic cleanup**: Removes temporary chunk files after processing
- **Russian language**: Transcription configured for Russian ("ru" at process.js:128)

**Configuration**:
- Supported video formats: `.mp4`, `.mov` (line 24)
- Audio format: WAV with pcm_s16le codec
- Chunk size: 20MB target (OpenAI limit is 25MB)
- API timeout: 10 minutes per chunk

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
- Modify `language` parameter in process.js at line 128
- Supported languages: https://platform.openai.com/docs/guides/speech-to-text

## Error Handling

The script implements comprehensive error handling:
- Skips files that fail and continues with remaining files
- Includes error markers in output for failed chunks
- Logs detailed error information (API status, network errors, etc.)
- Cleans up temporary files even when errors occur
- Won't re-process successfully completed files
