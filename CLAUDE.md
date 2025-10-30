# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Node.js ESM project for automated video transcription using ElevenLabs Scribe API. The project processes videos through a three-stage pipeline:

1. **Video** → Extract audio from video files
2. **Audio** → Transcribe audio using ElevenLabs Scribe API
3. **Text** → Save transcription results

## Environment Setup

**Required**: Create a `.env` file with:
```
ELEVENLABS_API_KEY=your_api_key_here
```

Get your API key from: https://elevenlabs.io/app/speech-to-text

## Running the Application

```bash
# Install dependencies
npm install

# Run the interactive transcription pipeline
npm start
# or
node index.js
```

## Folder Structure

The project uses three main folders (all added to .gitignore):

- **video/** - Place your video files here (.mp4, .mov)
- **audio/** - Extracted audio files in MP3 format (auto-generated)
- **text/** - Transcription results in .txt format (auto-generated)

## Architecture

### index.js (Main Entry Point)

**Core Workflow**:
1. Scans `video/` folder for .mp4 and .mov files
2. Presents interactive menu for each file (continue/skip/exit)
3. Extracts audio from video → saves as MP3 in `audio/` (skips if already exists)
4. Transcribes audio using ElevenLabs Scribe API → saves to `text/`
5. Automatically skips files that already have a .txt output

**Interactive Features**:
- Uses `inquirer` to present user-friendly menus before processing each file
- User can choose to: continue processing, skip current file, or exit program
- Shows progress indicators (e.g., "File 3/10")
- Displays detailed file info (size, duration) before transcription

**Key Features**:
- **Smart file handling**: Checks for existing .txt and .mp3 files to avoid reprocessing
- **Large file support**: Validates files up to 3GB and 10 hours duration before processing
- **MP3 format**: Extracts audio as compressed MP3 using libmp3lame codec
- **Speaker diarization**: Automatically identifies different speakers (configurable)
- **Robust error handling**: Continues processing remaining files if one fails
- **Russian language**: Default transcription language is Russian ("ru")
- **High accuracy**: Uses ElevenLabs Scribe v1 model

**ElevenLabs Scribe API Configuration** (lines 28-95):

The `TRANSCRIPTION_CONFIG` object contains all configurable parameters:
- `model_id`: "scribe_v1" (stable) or "scribe_v1_experimental"
- `language_code`: "ru" (Russian) - set to null for auto-detection
- `diarize`: true - enables speaker identification
- `num_speakers`: null - auto-detect number of speakers (1-32 if specified)
- `diarization_threshold`: null - uses model default (typically 0.22)
- `tag_audio_events`: true - tags (laughter), (footsteps), etc.
- `timestamps_granularity`: "word" - options: "none", "word", "character"
- `temperature`: null - output randomness (0.0-2.0)
- `seed`: null - for deterministic results
- `use_multi_channel`: false - for multi-channel audio (max 5 channels)
- `file_format`: "other" - or "pcm_s16le_16" for specific format
- `enable_logging`: true - set false for zero-retention (enterprise only)
- `webhook`: false - send results to webhook instead of waiting
- `webhook_id`: null - specific webhook to use

**Key Functions**:
- `getVideoFiles()` - Scans video directory for supported formats (index.js:111)
- `extractAudio()` - Uses fluent-ffmpeg to extract MP3 audio (index.js:134)
- `getAudioMetadata()` - Gets duration and size using ffprobe (index.js:161)
- `transcribeWithElevenLabs()` - Sends file to ElevenLabs API with config (index.js:191)
- `showFileMenu()` - Interactive inquirer menu (index.js:274)
- `transcribeAudioFile()` - Full transcription workflow with validation (index.js:307)
- `processVideoFile()` - Complete video→audio→text pipeline (index.js:373)
- `main()` - Entry point with initialization and loop (index.js:427)

**File Limits**:
- Supported video formats: `.mp4`, `.mov` (index.js:103)
- Audio format: MP3 with libmp3lame codec
- File size limit: 3GB (ElevenLabs limit, validated at index.js:327)
- Duration limit: 10 hours (ElevenLabs limit, validated at index.js:333)
- API timeout: 20 minutes for large files (index.js:245)

## Dependencies

- **axios** - HTTP client for ElevenLabs API calls
- **dotenv** - Environment variable management
- **fluent-ffmpeg** - FFmpeg wrapper for audio/video processing
- **@ffmpeg-installer/ffmpeg** - Bundled FFmpeg binary (no system install needed)
- **@ffprobe-installer/ffprobe** - Bundled FFprobe binary for metadata extraction
- **form-data** - Multipart form data for file uploads
- **inquirer** - Interactive CLI prompts and menus

## Usage Example

```bash
# 1. Place video files in video/ folder
cp /path/to/your/video.mp4 ./video/

# 2. Run the interactive processor
npm start

# 3. Follow the menu prompts for each file
# Choose: ✅ Continue, ⏭️ Skip, or 🚪 Exit

# 4. Find transcription in text/ folder
cat ./text/video.txt
```

## Changing Transcription Settings

To customize transcription behavior, modify the `TRANSCRIPTION_CONFIG` object in index.js (lines 28-95):

**Change language**:
```javascript
language_code: "en",  // English
language_code: null,  // Auto-detect
```

**Disable speaker diarization**:
```javascript
diarize: false,
```

**Specify exact number of speakers**:
```javascript
num_speakers: 2,  // Must be between 1-32
```

**Change timestamp detail**:
```javascript
timestamps_granularity: "character",  // More granular than "word"
```

ElevenLabs Scribe supports 99 languages. See: https://elevenlabs.io/docs/capabilities/speech-to-text

## Error Handling

The script implements comprehensive error handling:
- Validates file size (max 3GB) and duration (max 10 hours) before processing
- Detailed error logging (API status, network errors, stack traces)
- Continues with remaining files if one fails
- Won't re-process files with existing .txt output
- Shows clear error messages in Russian with troubleshooting context

## API Pricing

ElevenLabs Scribe pricing:
- Starting from $0.40 per hour of transcribed audio
- Lower rates available at scale with Enterprise plans
- More info: https://elevenlabs.io/speech-to-text
