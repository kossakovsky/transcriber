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
const ELEVENLABS_MODEL = "scribe_v1";
const MAX_FILE_SIZE_GB = 3; // ElevenLabs limit: 3GB
const MAX_DURATION_HOURS = 10; // ElevenLabs limit: 10 hours

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
    console.error(`❌ Папка ${VIDEO_DIR} не существует.`);
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
    console.log(`    🎬 Извлечение аудио из ${path.basename(videoPath)}...`);
    ffmpeg(videoPath)
      .output(outputPath)
      .audioCodec("libmp3lame") // MP3 codec
      .format("mp3")
      .on("end", () => {
        console.log(`    ✅ Аудио извлечено: ${path.basename(outputPath)}`);
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
  console.log(`    ☁️ Отправка файла ${filename} в ElevenLabs Scribe API...`);

  const formData = new FormData();
  formData.append("file", fs.createReadStream(filePath));
  formData.append("model_id", ELEVENLABS_MODEL);
  formData.append("language_code", "ru");
  formData.append("diarize", "true"); // Enable speaker diarization

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
    console.log(`    ✅ Файл ${filename} успешно транскрибирован.`);
    return response.data.text;
  } catch (error) {
    console.error(`    ❌ Ошибка при транскрибации файла ${filename}:`);
    if (error.response) {
      console.error(`       - Статус API: ${error.response.status}`);
      console.error(
        `       - Ответ API: ${JSON.stringify(error.response.data)}`
      );
    } else if (error.request) {
      console.error("       - Ошибка сети или нет ответа от сервера ElevenLabs.");
    } else {
      console.error(`       - ${error.message}`);
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
      message: `\n📂 Файл ${currentIndex}/${totalFiles}: "${fileName}"`,
      choices: [
        {
          name: "✅ Продолжить обработку",
          value: "continue",
        },
        {
          name: "⏭️  Пропустить этот файл",
          value: "skip",
        },
        {
          name: "🚪 Выход из программы",
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
    `[${index + 1}/${totalFiles}] 🎤 Транскрибация файла: ${baseFilename}`
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
      }/${totalFiles}] 💾 Транскрипция сохранена в: ${path.basename(
        outputPath
      )}`
    );
  } catch (error) {
    console.error(
      `[${index + 1
      }/${totalFiles}] ❌ Ошибка при обработке файла ${baseFilename}:`
    );
    if (error.response) {
      console.error(`   - Статус API: ${error.response.status}`);
      console.error(`   - Ответ API: ${JSON.stringify(error.response.data)}`);
    } else if (error.request) {
      console.error("   - Ошибка сети или нет ответа от сервера ElevenLabs.");
    } else {
      console.error(`   - ${error.message}`);
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
    `\n[${index + 1}/${totalFiles}] ▶️ Обработка видео: ${videoBasename}`
  );

  // Define output paths
  const audioPath = path.join(AUDIO_DIR, `${videoName}.mp3`);
  const textPath = path.join(TEXT_DIR, `${videoName}.txt`);

  // Check if already processed
  if (fs.existsSync(textPath)) {
    console.log(
      `[${index + 1
      }/${totalFiles}] ⏭️  Файл уже обработан, пропуск: ${videoBasename}`
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
        `[${index + 1}/${totalFiles}] ✅ Аудио файл уже существует: ${path.basename(audioPath)} (${audioSizeMB} MB)`
      );
      console.log(
        `[${index + 1}/${totalFiles}] ⏩ Пропускаем шаг извлечения аудио`
      );
    }

    // Step 2: Transcribe audio
    await transcribeAudioFile(audioPath, textPath, index, totalFiles);

    console.log(
      `[${index + 1}/${totalFiles}] ✅ Видео ${videoBasename} полностью обработано.`
    );
  } catch (error) {
    console.error(
      `[${index + 1
      }/${totalFiles}] ❌ Критическая ошибка при обработке видео ${videoBasename}:`
    );
    console.error(`   - ${error.message}`);
  }
}

/**
 * Main function to process all videos.
 */
async function main() {
  console.log(`🚀 Запуск скрипта обработки видео...`);

  // Check API key
  if (!ELEVENLABS_API_KEY) {
    console.error(
      "❌ ОШИБКА: API ключ ElevenLabs не найден. Убедитесь, что он задан в файле .env как ELEVENLABS_API_KEY."
    );
    return;
  }

  // Create directories if they don't exist
  [VIDEO_DIR, AUDIO_DIR, TEXT_DIR].forEach((dir) => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`📁 Создана папка: ${dir}`);
    }
  });

  // Get all video files
  const videoFiles = getVideoFiles();

  if (videoFiles.length === 0) {
    console.log(
      `🟡 Не найдено видео файлов в папке ${VIDEO_DIR}. Поддерживаемые форматы: ${VIDEO_EXTENSIONS.join(
        ", "
      )}`
    );
    return;
  }

  console.log(`Обнаружено видео файлов: ${videoFiles.length}`);

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
      console.log(`\n🚪 Выход из программы по запросу пользователя.`);
      console.log(`📊 Обработано файлов: ${processedCount} из ${totalFiles}`);
      console.log(`⏭️  Пропущено файлов: ${skippedCount}`);
      return;
    }

    if (userChoice === "skip") {
      console.log(`⏭️  Пропускаем файл: ${videoBasename}\n`);
      skippedCount++;
      continue;
    }

    // Process file if user chose "continue"
    await processVideoFile(videoFile, i, totalFiles);
    processedCount++;
    console.log(`---`);
  }

  console.log(`\n🏁 Все файлы обработаны.`);
  console.log(`📊 Обработано файлов: ${processedCount} из ${totalFiles}`);
  if (skippedCount > 0) {
    console.log(`⏭️  Пропущено файлов: ${skippedCount}`);
  }
}

// Run main function
main().catch((err) => {
  console.error("🚫 Произошла критическая ошибка в главной функции:", err);
});

