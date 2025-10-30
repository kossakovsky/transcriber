import fs from "fs";
import path from "path";
import axios from "axios";
import FormData from "form-data";
import ffmpeg from "fluent-ffmpeg";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import ffprobeInstaller from "@ffprobe-installer/ffprobe";
import inquirer from "inquirer";

// Tell fluent-ffmpeg where to find the ffmpeg and ffprobe binaries
ffmpeg.setFfmpegPath(ffmpegInstaller.path);
ffmpeg.setFfprobePath(ffprobeInstaller.path);

// Load environment variables
import dotenv from "dotenv";
dotenv.config();

// --- Configuration ---

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_API_URL = "https://api.elevenlabs.io/v1/speech-to-text";

// File size and duration limits
const MAX_FILE_SIZE_GB = 3; // ElevenLabs limit: 3GB
const MAX_DURATION_HOURS = 10; // ElevenLabs limit: 10 hours

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const params = {};

  args.forEach(arg => {
    if (arg.startsWith('--')) {
      const [key, value] = arg.slice(2).split('=');
      params[key] = value;
    }
  });

  return params;
}

const CLI_ARGS = parseArgs();
const LANGUAGE_CODE = CLI_ARGS.lang || "en"; // Default to English if not specified

// ElevenLabs Scribe API Parameters
// All parameters with their default values for explicit control
const TRANSCRIPTION_CONFIG = {
  // REQUIRED: Model ID for transcription
  // Options: "scribe_v1" (stable), "scribe_v1_experimental" (newer features)
  model_id: "scribe_v1",

  // Language code (ISO-639-1 or ISO-639-3)
  // If null/undefined, language is auto-detected
  // Examples: "en", "ru", "es", "de", "fr", etc.
  // This value is overridden by CLI argument --lang if provided
  language_code: LANGUAGE_CODE,

  // Speaker diarization - annotate who is speaking when
  // Default: false
  diarize: true,

  // Maximum number of speakers (1-32)
  // If null, uses model's maximum supported value
  // Only affects results when diarize=true
  num_speakers: null,

  // Diarization threshold (float)
  // Higher = less likely one speaker split into two, but more likely two speakers merged
  // Only available when diarize=true and num_speakers=null
  // If null, uses model default (typically 0.22)
  diarization_threshold: null,

  // Tag audio events like (laughter), (footsteps), etc.
  // Default: true
  tag_audio_events: true,

  // Timestamp granularity in transcription
  // Options: "none", "word", "character"
  // Default: "word"
  timestamps_granularity: "word",

  // Temperature for output randomness (0.0 - 2.0)
  // Higher = more diverse/less deterministic results
  // If null, uses model default (typically 0)
  temperature: null,

  // Seed for deterministic sampling (0 - 2147483647)
  // Same seed + params should return same result (not guaranteed)
  // If null, non-deterministic
  seed: null,

  // Multi-channel audio support (max 5 channels)
  // Each channel contains one speaker and is transcribed independently
  // Default: false
  use_multi_channel: false,

  // Input audio format
  // Options: "pcm_s16le_16" (16-bit PCM, 16kHz, mono, little-endian) or "other"
  // Default: "other"
  file_format: "other",

  // Enable logging and history features
  // Set to false for zero-retention mode (enterprise only)
  // Default: true
  enable_logging: true,

  // Send results to configured webhooks instead of waiting for response
  // Default: false
  webhook: false,

  // Specific webhook ID to send results to (only if webhook=true)
  // If null, sends to all configured webhooks
  webhook_id: null,
};

// Folder paths
const VIDEO_DIR = "./video";
const AUDIO_DIR = "./audio";
const TEXT_DIR = "./text";

// Supported video formats
const VIDEO_EXTENSIONS = [".mp4", ".mov"];

// --- Helper Functions ---

/**
 * Get all video files from the video directory.
 * @returns {string[]} - Array of video file paths.
 */
function getVideoFiles() {
  if (!fs.existsSync(VIDEO_DIR)) {
    console.error(`❌  Folder ${VIDEO_DIR} does not exist.`);
    return [];
  }

  const files = fs.readdirSync(VIDEO_DIR);
  const videoFiles = files
    .filter((file) => {
      const ext = path.extname(file).toLowerCase();
      return VIDEO_EXTENSIONS.includes(ext);
    })
    .map((file) => path.join(VIDEO_DIR, file));

  return videoFiles;
}

/**
 * Extract audio from video file.
 * @param {string} videoPath - Path to video file.
 * @param {string} outputPath - Path for output audio file.
 * @returns {Promise<void>}
 */
function extractAudio(videoPath, outputPath) {
  return new Promise((resolve, reject) => {
    console.log(`    🎬  Extracting audio from ${path.basename(videoPath)}...`);
    ffmpeg(videoPath)
      .output(outputPath)
      .audioCodec("libmp3lame") // MP3 codec
      .format("mp3")
      .on("end", () => {
        console.log(`    ✅  Audio extracted: ${path.basename(outputPath)}`);
        resolve();
      })
      .on("error", (err) => {
        reject(
          new Error(
            `Error extracting audio from ${videoPath}: ${err.message}`
          )
        );
      })
      .run();
  });
}

/**
 * Get audio file metadata (duration, size).
 * @param {string} filePath - Path to the file.
 * @returns {Promise<object>} - Promise with metadata { duration, size }.
 */
function getAudioMetadata(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) {
        return reject(
          new Error(
            `Error getting metadata for ${filePath}: ${err.message}`
          )
        );
      }
      const duration = metadata.format.duration;
      const size = metadata.format.size;
      if (duration === undefined || size === undefined) {
        return reject(
          new Error(
            `Failed to get duration or size for ${filePath}`
          )
        );
      }
      resolve({ duration, size });
    });
  });
}

/**
 * Transcribe audio file using ElevenLabs Scribe API.
 * @param {string} filePath - Path to audio file.
 * @param {string} apiKey - ElevenLabs API key.
 * @returns {Promise<string>} - Promise with transcription text.
 */
async function transcribeWithElevenLabs(filePath, apiKey) {
  const filename = path.basename(filePath);
  console.log(`    ☁️  Sending file ${filename} to ElevenLabs Scribe API...`);

  const formData = new FormData();
  formData.append("file", fs.createReadStream(filePath));

  // Add all configuration parameters from TRANSCRIPTION_CONFIG
  // Only add non-null values to the form data
  formData.append("model_id", TRANSCRIPTION_CONFIG.model_id);

  if (TRANSCRIPTION_CONFIG.language_code !== null) {
    formData.append("language_code", TRANSCRIPTION_CONFIG.language_code);
  }

  formData.append("diarize", String(TRANSCRIPTION_CONFIG.diarize));

  if (TRANSCRIPTION_CONFIG.num_speakers !== null) {
    formData.append("num_speakers", String(TRANSCRIPTION_CONFIG.num_speakers));
  }

  if (TRANSCRIPTION_CONFIG.diarization_threshold !== null) {
    formData.append("diarization_threshold", String(TRANSCRIPTION_CONFIG.diarization_threshold));
  }

  formData.append("tag_audio_events", String(TRANSCRIPTION_CONFIG.tag_audio_events));
  formData.append("timestamps_granularity", TRANSCRIPTION_CONFIG.timestamps_granularity);

  if (TRANSCRIPTION_CONFIG.temperature !== null) {
    formData.append("temperature", String(TRANSCRIPTION_CONFIG.temperature));
  }

  if (TRANSCRIPTION_CONFIG.seed !== null) {
    formData.append("seed", String(TRANSCRIPTION_CONFIG.seed));
  }

  formData.append("use_multi_channel", String(TRANSCRIPTION_CONFIG.use_multi_channel));
  formData.append("file_format", TRANSCRIPTION_CONFIG.file_format);
  formData.append("enable_logging", String(TRANSCRIPTION_CONFIG.enable_logging));
  formData.append("webhook", String(TRANSCRIPTION_CONFIG.webhook));

  if (TRANSCRIPTION_CONFIG.webhook_id !== null) {
    formData.append("webhook_id", TRANSCRIPTION_CONFIG.webhook_id);
  }

  try {
    const response = await axios.post(
      ELEVENLABS_API_URL,
      formData,
      {
        headers: {
          ...formData.getHeaders(),
          "xi-api-key": apiKey,
        },
        timeout: 1200000, // 20 minutes for large files
      }
    );
    console.log(`    ✅  File ${filename} successfully transcribed.`);
    return response.data.text;
  } catch (error) {
    console.error(`    ❌  Error transcribing file ${filename}:`);
    if (error.response) {
      console.error(`        - API Status: ${error.response.status}`);
      console.error(
        `        - API Response: ${JSON.stringify(error.response.data)}`
      );
    } else if (error.request) {
      console.error("        - Network error or no response from ElevenLabs server.");
    } else {
      console.error(`        - ${error.message}`);
    }
    throw error;
  }
}


/**
 * Show interactive menu for file processing options.
 * @param {string} fileName - Name of the file to be processed.
 * @param {number} currentIndex - Current file index (1-based).
 * @param {number} totalFiles - Total number of files.
 * @returns {Promise<string>} - Promise that resolves to user choice: 'continue', 'skip', or 'exit'.
 */
async function showFileMenu(fileName, currentIndex, totalFiles) {
  const answer = await inquirer.prompt([
    {
      type: "list",
      name: "action",
      message: `📂  File ${currentIndex}/${totalFiles}: "${fileName}"`,
      choices: [
        {
          name: "✅  Continue processing",
          value: "continue",
        },
        {
          name: "⏭️  Skip this file",
          value: "skip",
        },
        {
          name: "🚪  Exit program",
          value: "exit",
        },
      ],
    },
  ]);

  return answer.action;
}

/**
 * Transcribe one audio file using ElevenLabs Scribe API.
 * @param {string} filePath - Path to audio file.
 * @param {string} outputPath - Path to save transcription text.
 * @param {number} index - File index (for logging).
 * @param {number} totalFiles - Total number of files (for logging).
 */
async function transcribeAudioFile(filePath, outputPath, index, totalFiles) {
  const baseFilename = path.basename(filePath);
  console.log(
    `[${index + 1}/${totalFiles}] 🎤  Transcribing file: ${baseFilename}`
  );

  try {
    const { duration, size } = await getAudioMetadata(filePath);
    console.log(
      `[${index + 1}/${totalFiles}] ℹ️  Size: ${(size / 1024 / 1024).toFixed(
        2
      )} MB, Duration: ${Math.floor(duration / 60)}m ${Math.round(
        duration % 60
      )}s`
    );

    // Check file size limits (ElevenLabs: 3GB, 10 hours)
    const sizeGB = size / (1024 * 1024 * 1024);
    const durationHours = duration / 3600;

    if (sizeGB > MAX_FILE_SIZE_GB) {
      throw new Error(
        `File exceeds size limit: ${sizeGB.toFixed(2)}GB > ${MAX_FILE_SIZE_GB}GB`
      );
    }

    if (durationHours > MAX_DURATION_HOURS) {
      throw new Error(
        `File exceeds duration limit: ${durationHours.toFixed(2)}h > ${MAX_DURATION_HOURS}h`
      );
    }

    const transcript = await transcribeWithElevenLabs(filePath, ELEVENLABS_API_KEY);

    fs.writeFileSync(outputPath, transcript, "utf8");
    console.log(
      `[${index + 1
      }/${totalFiles}] 💾  Transcription saved to: ${path.basename(
        outputPath
      )}`
    );
  } catch (error) {
    console.error(
      `[${index + 1
      }/${totalFiles}] ❌  Error processing file ${baseFilename}:`
    );
    if (error.response) {
      console.error(`       - API Status: ${error.response.status}`);
      console.error(`       - API Response: ${JSON.stringify(error.response.data)}`);
    } else if (error.request) {
      console.error("       - Network error or no response from ElevenLabs server.");
    } else {
      console.error(`       - ${error.message}`);
      if (error.stack) {
        console.error(error.stack);
      }
    }
  }
}

/**
 * Process one video file: extract audio and transcribe.
 * @param {string} videoPath - Path to video file.
 * @param {number} index - File index (for logging).
 * @param {number} totalFiles - Total number of files (for logging).
 */
async function processVideoFile(videoPath, index, totalFiles) {
  const videoBasename = path.basename(videoPath);
  const videoName = path.basename(videoPath, path.extname(videoPath));

  console.log(
    `\n[${index + 1}/${totalFiles}] ▶️  Processing video: ${videoBasename}`
  );

  // Define output paths
  const audioPath = path.join(AUDIO_DIR, `${videoName}.mp3`);
  const textPath = path.join(TEXT_DIR, `${videoName}.txt`);

  // Check if already processed
  if (fs.existsSync(textPath)) {
    console.log(
      `[${index + 1
      }/${totalFiles}] ⏭️  File already processed, skipping: ${videoBasename}\n`
    );
    return;
  }

  try {
    // Step 1: Extract audio if not already done
    if (!fs.existsSync(audioPath)) {
      await extractAudio(videoPath, audioPath);
    } else {
      const audioStats = fs.statSync(audioPath);
      const audioSizeMB = (audioStats.size / 1024 / 1024).toFixed(2);
      console.log(
        `[${index + 1}/${totalFiles}] ✅  Audio file already exists: ${path.basename(audioPath)} (${audioSizeMB} MB)`
      );
      console.log(
        `[${index + 1}/${totalFiles}] ⏩  Skipping audio extraction step`
      );
    }

    // Step 2: Transcribe audio
    await transcribeAudioFile(audioPath, textPath, index, totalFiles);

    console.log(
      `[${index + 1}/${totalFiles}] ✅  Video ${videoBasename} fully processed.\n`
    );
  } catch (error) {
    console.error(
      `[${index + 1
      }/${totalFiles}] ❌  Critical error processing video ${videoBasename}:`
    );
    console.error(`   - ${error.message}\n`);
  }
}

/**
 * Main function to process all videos.
 */
async function main() {
  console.log(`\n🚀  Starting video processing script...\n`);

  // Display language setting
  if (CLI_ARGS.lang) {
    console.log(`🌍  Transcription language (from parameter): ${LANGUAGE_CODE}\n`);
  } else {
    console.log(`🌍  Transcription language (default): ${LANGUAGE_CODE}\n`);
  }

  // Check API key
  if (!ELEVENLABS_API_KEY) {
    console.error(
      "❌  ERROR: ElevenLabs API key not found. Make sure it is set in the .env file as ELEVENLABS_API_KEY.\n"
    );
    return;
  }

  // Create directories if they don't exist
  [VIDEO_DIR, AUDIO_DIR, TEXT_DIR].forEach((dir) => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`📁  Folder created: ${dir}`);
    }
  });

  // Get all video files
  const videoFiles = getVideoFiles();

  if (videoFiles.length === 0) {
    console.log(
      `🟡  No video files found in folder ${VIDEO_DIR}. Supported formats: ${VIDEO_EXTENSIONS.join(
        ", "
      )}\n`
    );
    return;
  }

  console.log(`📊  Video files found: ${videoFiles.length}\n`);

  // Process each video file
  const totalFiles = videoFiles.length;
  let processedCount = 0;
  let skippedCount = 0;

  for (let i = 0; i < totalFiles; i++) {
    const videoFile = videoFiles[i];
    const videoBasename = path.basename(videoFile);

    // Show menu before processing each file
    const userChoice = await showFileMenu(videoBasename, i + 1, totalFiles);

    if (userChoice === "exit") {
      console.log(`\n🚪  Exiting program by user request.\n`);
      console.log(`📊  Files processed: ${processedCount} of ${totalFiles}`);
      console.log(`⏭️  Files skipped: ${skippedCount}\n`);
      return;
    }

    if (userChoice === "skip") {
      console.log(`\n⏭️  Skipping file: ${videoBasename}`);
      console.log(`${"─".repeat(60)}\n`);
      skippedCount++;
      continue;
    }

    // Process file if user chose "continue"
    await processVideoFile(videoFile, i, totalFiles);
    processedCount++;
    console.log(`${"─".repeat(60)}\n`);
  }

  console.log(`\n🏁  All files processed!\n`);
  console.log(`📊  Files processed: ${processedCount} of ${totalFiles}`);
  if (skippedCount > 0) {
    console.log(`⏭️  Files skipped: ${skippedCount}`);
  }
  console.log("");
}

// Run main function
main().catch((err) => {
  console.error("\n🚫  A critical error occurred in the main function:", err);
});

