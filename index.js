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

// ElevenLabs Scribe API Parameters
// Все параметры с их дефолтными значениями для явного контроля
const TRANSCRIPTION_CONFIG = {
  // REQUIRED: Model ID for transcription
  // Options: "scribe_v1" (stable), "scribe_v1_experimental" (newer features)
  model_id: "scribe_v1",

  // Language code (ISO-639-1 or ISO-639-3)
  // If null/undefined, language is auto-detected
  // Examples: "ru", "en", "es", "de", "fr", etc.
  language_code: "ru",

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
    console.error(`❌  Папка ${VIDEO_DIR} не существует.`);
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
    console.log(`    🎬  Извлечение аудио из ${path.basename(videoPath)}...`);
    ffmpeg(videoPath)
      .output(outputPath)
      .audioCodec("libmp3lame") // MP3 codec
      .format("mp3")
      .on("end", () => {
        console.log(`    ✅  Аудио извлечено: ${path.basename(outputPath)}`);
        resolve();
      })
      .on("error", (err) => {
        reject(
          new Error(
            `Ошибка при извлечении аудио из ${videoPath}: ${err.message}`
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
            `Ошибка при получении метаданных ${filePath}: ${err.message}`
          )
        );
      }
      const duration = metadata.format.duration;
      const size = metadata.format.size;
      if (duration === undefined || size === undefined) {
        return reject(
          new Error(
            `Не удалось получить длительность или размер для ${filePath}`
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
  console.log(`    ☁️  Отправка файла ${filename} в ElevenLabs Scribe API...`);

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
    console.log(`    ✅  Файл ${filename} успешно транскрибирован.`);
    return response.data.text;
  } catch (error) {
    console.error(`    ❌  Ошибка при транскрибации файла ${filename}:`);
    if (error.response) {
      console.error(`        - Статус API: ${error.response.status}`);
      console.error(
        `        - Ответ API: ${JSON.stringify(error.response.data)}`
      );
    } else if (error.request) {
      console.error("        - Ошибка сети или нет ответа от сервера ElevenLabs.");
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
      message: `📂  Файл ${currentIndex}/${totalFiles}: "${fileName}"`,
      choices: [
        {
          name: "✅  Продолжить обработку",
          value: "continue",
        },
        {
          name: "⏭️  Пропустить этот файл",
          value: "skip",
        },
        {
          name: "🚪  Выход из программы",
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
    `[${index + 1}/${totalFiles}] 🎤  Транскрибация файла: ${baseFilename}`
  );

  try {
    const { duration, size } = await getAudioMetadata(filePath);
    console.log(
      `[${index + 1}/${totalFiles}] ℹ️  Размер: ${(size / 1024 / 1024).toFixed(
        2
      )} MB, Длительность: ${Math.floor(duration / 60)}m ${Math.round(
        duration % 60
      )}s`
    );

    // Check file size limits (ElevenLabs: 3GB, 10 hours)
    const sizeGB = size / (1024 * 1024 * 1024);
    const durationHours = duration / 3600;

    if (sizeGB > MAX_FILE_SIZE_GB) {
      throw new Error(
        `Файл превышает лимит размера: ${sizeGB.toFixed(2)}GB > ${MAX_FILE_SIZE_GB}GB`
      );
    }

    if (durationHours > MAX_DURATION_HOURS) {
      throw new Error(
        `Файл превышает лимит длительности: ${durationHours.toFixed(2)}h > ${MAX_DURATION_HOURS}h`
      );
    }

    const transcript = await transcribeWithElevenLabs(filePath, ELEVENLABS_API_KEY);

    fs.writeFileSync(outputPath, transcript, "utf8");
    console.log(
      `[${index + 1
      }/${totalFiles}] 💾  Транскрипция сохранена в: ${path.basename(
        outputPath
      )}`
    );
  } catch (error) {
    console.error(
      `[${index + 1
      }/${totalFiles}] ❌  Ошибка при обработке файла ${baseFilename}:`
    );
    if (error.response) {
      console.error(`       - Статус API: ${error.response.status}`);
      console.error(`       - Ответ API: ${JSON.stringify(error.response.data)}`);
    } else if (error.request) {
      console.error("       - Ошибка сети или нет ответа от сервера ElevenLabs.");
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
    `\n[${index + 1}/${totalFiles}] ▶️  Обработка видео: ${videoBasename}`
  );

  // Define output paths
  const audioPath = path.join(AUDIO_DIR, `${videoName}.mp3`);
  const textPath = path.join(TEXT_DIR, `${videoName}.txt`);

  // Check if already processed
  if (fs.existsSync(textPath)) {
    console.log(
      `[${index + 1
      }/${totalFiles}] ⏭️  Файл уже обработан, пропуск: ${videoBasename}\n`
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
        `[${index + 1}/${totalFiles}] ✅  Аудио файл уже существует: ${path.basename(audioPath)} (${audioSizeMB} MB)`
      );
      console.log(
        `[${index + 1}/${totalFiles}] ⏩  Пропускаем шаг извлечения аудио`
      );
    }

    // Step 2: Transcribe audio
    await transcribeAudioFile(audioPath, textPath, index, totalFiles);

    console.log(
      `[${index + 1}/${totalFiles}] ✅  Видео ${videoBasename} полностью обработано.\n`
    );
  } catch (error) {
    console.error(
      `[${index + 1
      }/${totalFiles}] ❌  Критическая ошибка при обработке видео ${videoBasename}:`
    );
    console.error(`   - ${error.message}\n`);
  }
}

/**
 * Main function to process all videos.
 */
async function main() {
  console.log(`\n🚀  Запуск скрипта обработки видео...\n`);

  // Check API key
  if (!ELEVENLABS_API_KEY) {
    console.error(
      "❌  ОШИБКА: API ключ ElevenLabs не найден. Убедитесь, что он задан в файле .env как ELEVENLABS_API_KEY.\n"
    );
    return;
  }

  // Create directories if they don't exist
  [VIDEO_DIR, AUDIO_DIR, TEXT_DIR].forEach((dir) => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`📁  Создана папка: ${dir}`);
    }
  });

  // Get all video files
  const videoFiles = getVideoFiles();

  if (videoFiles.length === 0) {
    console.log(
      `🟡  Не найдено видео файлов в папке ${VIDEO_DIR}. Поддерживаемые форматы: ${VIDEO_EXTENSIONS.join(
        ", "
      )}\n`
    );
    return;
  }

  console.log(`📊  Обнаружено видео файлов: ${videoFiles.length}\n`);

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
      console.log(`\n🚪  Выход из программы по запросу пользователя.\n`);
      console.log(`📊  Обработано файлов: ${processedCount} из ${totalFiles}`);
      console.log(`⏭️  Пропущено файлов: ${skippedCount}\n`);
      return;
    }

    if (userChoice === "skip") {
      console.log(`\n⏭️  Пропускаем файл: ${videoBasename}`);
      console.log(`${"─".repeat(60)}\n`);
      skippedCount++;
      continue;
    }

    // Process file if user chose "continue"
    await processVideoFile(videoFile, i, totalFiles);
    processedCount++;
    console.log(`${"─".repeat(60)}\n`);
  }

  console.log(`\n🏁  Все файлы обработаны!\n`);
  console.log(`📊  Обработано файлов: ${processedCount} из ${totalFiles}`);
  if (skippedCount > 0) {
    console.log(`⏭️  Пропущено файлов: ${skippedCount}`);
  }
  console.log("");
}

// Run main function
main().catch((err) => {
  console.error("\n🚫  Произошла критическая ошибка в главной функции:", err);
});

