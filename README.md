# Video Transcriber

An automated video transcription tool powered by ElevenLabs Scribe API. This Node.js application extracts audio from video files and generates accurate transcriptions with speaker diarization support.

## Features

- 🎬 **Video to Audio Extraction** - Automatically extracts audio from MP4 and MOV files
- ☁️ **ElevenLabs Scribe API Integration** - Best-in-class transcription accuracy
- 🗣️ **Speaker Diarization** - Automatically identifies and labels different speakers
- 📝 **Audio Event Tagging** - Detects and annotates non-speech events like (laughter), (footsteps)
- 🔄 **Smart Processing** - Skips already processed files to save time and API costs
- 💾 **Efficient Storage** - Uses MP3 compression for audio files
- 📊 **Interactive CLI** - User-friendly menus with progress tracking
- 🌍 **Multi-language Support** - Supports 99 languages (default: Russian)
- ⚡ **Large File Support** - Handles files up to 3GB and 10 hours duration
- 🛡️ **Robust Error Handling** - Continues processing even if individual files fail

## Prerequisites

- Node.js (v14 or higher)
- ElevenLabs API key ([Get one here](https://elevenlabs.io/app/speech-to-text))
- FFmpeg (bundled automatically via dependencies)

## Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd transcriber
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment variables**

   Create a `.env` file in the project root:
   ```bash
   cp .env.example .env
   ```

   Edit `.env` and add your ElevenLabs API key:
   ```
   ELEVENLABS_API_KEY=your_api_key_here
   ```

## Quick Start

1. **Place your video files** in the `video/` folder:
   ```bash
   cp /path/to/your/video.mp4 ./video/
   ```

2. **Run the transcriber**:
   ```bash
   npm start
   ```

3. **Follow the interactive prompts** for each file:
   - ✅ **Continue** - Process the current file
   - ⏭️ **Skip** - Skip to the next file
   - 🚪 **Exit** - Stop the program

4. **Find your transcriptions** in the `text/` folder:
   ```bash
   cat ./text/your-video.txt
   ```

## Project Structure

```
transcriber/
├── index.js           # Main application entry point
├── package.json       # Project dependencies and scripts
├── .env              # Environment variables (not in repo)
├── .env.example      # Environment template
├── video/            # Place video files here (.mp4, .mov)
├── audio/            # Extracted audio files (auto-generated)
└── text/             # Transcription results (auto-generated)
```

## Configuration

### Transcription Settings

All transcription parameters can be configured in `index.js` by modifying the `TRANSCRIPTION_CONFIG` object (lines 28-95):

#### Language Settings

```javascript
// Russian (default)
language_code: "ru",

// English
language_code: "en",

// Auto-detect language
language_code: null,
```

#### Speaker Diarization

```javascript
// Enable speaker identification (default)
diarize: true,

// Auto-detect number of speakers
num_speakers: null,

// Or specify exact number (1-32)
num_speakers: 2,

// Adjust diarization sensitivity
diarization_threshold: 0.22,  // Higher = fewer speaker splits
```

#### Audio Event Tagging

```javascript
// Tag events like (laughter), (applause), etc.
tag_audio_events: true,
```

#### Timestamp Granularity

```javascript
timestamps_granularity: "word",      // Per-word timestamps
timestamps_granularity: "character", // Per-character timestamps
timestamps_granularity: "none",      // No timestamps
```

#### Advanced Options

```javascript
// Model selection
model_id: "scribe_v1",              // Stable version
model_id: "scribe_v1_experimental", // Latest features

// Deterministic output
seed: 12345,          // Same seed = same results
temperature: 0.0,     // Lower = more deterministic

// Multi-channel audio
use_multi_channel: false, // Set true for multi-channel files (max 5)

// Privacy mode (Enterprise only)
enable_logging: false,    // Zero-retention mode

// Webhook integration
webhook: false,
webhook_id: null,
```

### File Format Support

**Supported Video Formats:**
- `.mp4` - MPEG-4 video files
- `.mov` - QuickTime video files

**Output Formats:**
- Audio: MP3 (compressed, efficient storage)
- Transcription: Plain text (.txt)

### File Size Limits

- **Maximum file size:** 3GB (ElevenLabs API limit)
- **Maximum duration:** 10 hours (ElevenLabs API limit)
- **API timeout:** 20 minutes per file

The application automatically validates files before processing and will skip files that exceed these limits.

## How It Works

### Processing Pipeline

```
Video File (.mp4/.mov)
    ↓
[1. Audio Extraction]
    ↓
Audio File (.mp3)
    ↓
[2. ElevenLabs Scribe API]
    ↓
Transcription (.txt)
```

### Step-by-Step Process

1. **File Discovery** - Scans the `video/` folder for supported video files
2. **Smart Skipping** - Checks if transcription already exists (looks for matching .txt file)
3. **Interactive Menu** - Prompts user for action (continue/skip/exit)
4. **Audio Extraction** - Uses FFmpeg to extract audio as MP3 (skipped if .mp3 already exists)
5. **Metadata Validation** - Checks file size and duration against API limits
6. **Transcription** - Sends audio to ElevenLabs Scribe API with configured parameters
7. **Save Results** - Writes transcription to `text/` folder
8. **Progress Tracking** - Shows detailed progress and statistics

### Interactive Features

The application uses an interactive CLI with the following features:

- **File-by-file confirmation** - Control which files to process
- **Progress indicators** - "Processing file 3/10"
- **Detailed file info** - Size, duration, and status for each file
- **Error recovery** - Continues with remaining files if one fails
- **Summary statistics** - Shows total processed and skipped files at the end

## Usage Examples

### Basic Usage

```bash
# Process all videos in the video/ folder
npm start
```

### Batch Processing Multiple Files

```bash
# Copy multiple videos
cp /path/to/videos/*.mp4 ./video/

# Run the transcriber
npm start

# The interactive menu will appear for each file
```

### Processing Only New Files

The application automatically skips files that have already been transcribed:

```bash
# Run again - already processed files will be skipped automatically
npm start
```

### Viewing Transcriptions

```bash
# View a specific transcription
cat ./text/my-video.txt

# List all transcriptions
ls -lh ./text/

# Search within transcriptions
grep "keyword" ./text/*.txt
```

## API Information

### ElevenLabs Scribe

This project uses the [ElevenLabs Scribe API](https://elevenlabs.io/speech-to-text) for transcription.

**Key Features:**
- 99 language support
- Speaker diarization
- Audio event detection
- Word-level timestamps
- Best-in-class accuracy

**Pricing:**
- Starting from $0.40 per hour of audio
- Enterprise plans available with volume discounts
- Pay-as-you-go, no monthly minimums

**Rate Limits:**
- File size: Max 3GB
- Duration: Max 10 hours per file
- Formats: MP3, WAV, M4A, and many more

[View full documentation](https://elevenlabs.io/docs/capabilities/speech-to-text)

## Troubleshooting

### "API key not found" error

**Problem:** The application can't find your ElevenLabs API key.

**Solution:**
1. Ensure `.env` file exists in the project root
2. Check that `ELEVENLABS_API_KEY` is set correctly
3. Verify no extra spaces or quotes around the key
4. Restart the application after modifying `.env`

### "File exceeds size limit" error

**Problem:** Video file is larger than 3GB.

**Solution:**
1. Compress the video before processing
2. Split large videos into smaller segments
3. Use a video compression tool (HandBrake, FFmpeg CLI)

### "No video files found" warning

**Problem:** The `video/` folder is empty or contains unsupported formats.

**Solution:**
1. Ensure video files are in `video/` folder
2. Verify files have `.mp4` or `.mov` extensions
3. Check file permissions (must be readable)

### Transcription errors or poor quality

**Problem:** Transcription contains errors or misidentified speakers.

**Solutions:**
1. **Audio quality** - Ensure clear audio without excessive background noise
2. **Language setting** - Verify `language_code` matches the spoken language
3. **Speaker count** - Set `num_speakers` if you know the exact number
4. **Diarization threshold** - Adjust if speakers are being merged or split incorrectly

### FFmpeg errors

**Problem:** Audio extraction fails with FFmpeg errors.

**Solution:**
The application bundles FFmpeg automatically. If you encounter issues:
1. Delete `node_modules/` and reinstall: `npm install`
2. Check video file integrity (try playing it in a video player)
3. Try converting the video to MP4 format first

### Network or timeout errors

**Problem:** API requests fail or timeout.

**Solutions:**
1. Check your internet connection
2. Verify API key is valid and has sufficient credits
3. For very large files, ensure stable connection for 20+ minutes
4. Try processing smaller files first to verify setup

## Development

### Project Dependencies

- **axios** - HTTP client for API requests
- **dotenv** - Environment variable management
- **fluent-ffmpeg** - FFmpeg wrapper for audio/video processing
- **@ffmpeg-installer/ffmpeg** - Bundled FFmpeg binary
- **@ffprobe-installer/ffprobe** - Bundled FFprobe for metadata extraction
- **form-data** - Multipart form data for file uploads
- **inquirer** - Interactive CLI prompts

### Running in Development

```bash
# Install dependencies
npm install

# Run the application
node index.js
```

### Modifying the Code

The entire application is contained in a single file (`index.js`) for simplicity:

- **Lines 18-95:** Configuration and constants
- **Lines 107-126:** File discovery functions
- **Lines 134-154:** Audio extraction
- **Lines 161-183:** Metadata extraction
- **Lines 191-264:** ElevenLabs API integration
- **Lines 274-298:** Interactive menu
- **Lines 307-365:** Audio transcription logic
- **Lines 373-422:** Video processing pipeline
- **Lines 427-503:** Main application entry point

## Language Support

ElevenLabs Scribe supports 99 languages. Common language codes:

| Language | Code | Language | Code |
|----------|------|----------|------|
| English | `en` | Spanish | `es` |
| Russian | `ru` | French | `fr` |
| German | `de` | Italian | `it` |
| Portuguese | `pt` | Chinese | `zh` |
| Japanese | `ja` | Korean | `ko` |
| Arabic | `ar` | Hindi | `hi` |

For a complete list, see: [ElevenLabs Language Support](https://elevenlabs.io/docs/capabilities/speech-to-text)

## Performance Tips

1. **Use MP3 for storage** - The application automatically converts to MP3, which is much smaller than WAV
2. **Process in batches** - The interactive menu allows you to skip files if needed
3. **Reuse extracted audio** - Already extracted MP3 files are reused if you run the script again
4. **Monitor API usage** - Check your ElevenLabs dashboard to track costs
5. **Set correct language** - Language detection works but is slower than specifying the language

## License

This project is licensed under the ISC License.

## Support

For issues related to:
- **This application** - Open an issue in this repository
- **ElevenLabs API** - Contact [ElevenLabs support](https://elevenlabs.io/support)
- **FFmpeg** - See [FFmpeg documentation](https://ffmpeg.org/documentation.html)

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Changelog

### Current Version (1.0.0)
- Interactive CLI with file-by-file confirmation
- Full ElevenLabs Scribe API parameter support
- Speaker diarization and audio event tagging
- Smart file skipping to avoid reprocessing
- Comprehensive error handling and validation
- Support for MP4 and MOV video formats
- Automatic audio extraction to MP3
- Russian language default with 99 language support
