import fs from "fs";
import path from "path";
import os from "os";
import axios from "axios";
import FormData from "form-data";
import ffmpeg from "fluent-ffmpeg";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import ffprobeInstaller from "@ffprobe-installer/ffprobe";

// Tell fluent-ffmpeg where to find the ffmpeg and ffprobe binaries
ffmpeg.setFfmpegPath(ffmpegInstaller.path);
ffmpeg.setFfprobePath(ffprobeInstaller.path);

// Load environment variables
import dotenv from "dotenv";
dotenv.config();

// --- Configuration ---

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_API_LIMIT_MB = 25; // OpenAI API limit in MB
const CHUNK_SIZE_MB = 20; // Target chunk size in MB (slightly less than the limit)
const MAX_FILE_SIZE = OPENAI_API_LIMIT_MB * 1024 * 1024;
const TARGET_CHUNK_SIZE_BYTES = CHUNK_SIZE_MB * 1024 * 1024;

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
 * Transcribe one small audio file (chunk).
 * @param {string} filePath - Path to audio file (or chunk).
 * @param {string} apiKey - OpenAI API key.
 * @returns {Promise<string>} - Promise with transcription text.
 */
async function transcribeChunk(filePath, apiKey) {
  const chunkFilename = path.basename(filePath);
  console.log(`    ☁️ Отправка чанка ${chunkFilename} в OpenAI API...`);
  const formData = new FormData();
  formData.append("file", fs.createReadStream(filePath));
  formData.append("model", "whisper-1");
  formData.append("language", "ru");

  try {
    const response = await axios.post(
      "https://api.openai.com/v1/audio/transcriptions",
      formData,
      {
        headers: {
          ...formData.getHeaders(),
          Authorization: `Bearer ${apiKey}`,
        },
        timeout: 600000, // 10 minutes
      }
    );
    console.log(`    ✅ Чанк ${chunkFilename} успешно транскрибирован.`);
    return response.data.text;
  } catch (error) {
    console.error(`    ❌ Ошибка при транскрибации чанка ${chunkFilename}:`);
    if (error.response) {
      console.error(`       - Статус API: ${error.response.status}`);
      console.error(
        `       - Ответ API: ${JSON.stringify(error.response.data)}`
      );
    } else if (error.request) {
      console.error("       - Ошибка сети или нет ответа от сервера OpenAI.");
    } else {
      console.error(`       - ${error.message}`);
    }
    return `[ОШИБКА ТРАНСКРИБАЦИИ ЧАНКА: ${chunkFilename}]`;
  }
}

/**
 * Split audio file into chunks by size.
 * @param {string} inputPath - Path to source file.
 * @param {string} outputDir - Directory to save chunks.
 * @param {number} duration - Total audio duration in seconds.
 * @param {number} fileSize - File size in bytes.
 * @param {number} targetChunkSizeBytes - Target chunk size in bytes.
 * @returns {Promise<string[]>} - Promise with list of chunk paths.
 */
function splitAudioFile(
  inputPath,
  outputDir,
  duration,
  fileSize,
  targetChunkSizeBytes
) {
  return new Promise((resolve, reject) => {
    const numChunks = Math.ceil(fileSize / targetChunkSizeBytes);
    const chunkDuration = Math.floor(duration / numChunks);
    const outputPattern = path.join(
      outputDir,
      `chunk_%03d${path.extname(inputPath)}`
    );
    const chunkPaths = [];

    console.log(
      `    🕒 Разделение на ${numChunks} частей (примерно по ${chunkDuration} сек)...`
    );

    ffmpeg(inputPath)
      .outputOptions([
        "-f segment",
        `-segment_time ${chunkDuration}`,
        "-c copy",
        "-reset_timestamps 1",
      ])
      .output(outputPattern)
      .on("end", () => {
        for (let i = 0; i < numChunks; i++) {
          const chunkName = `chunk_${String(i).padStart(3, "0")}${path.extname(
            inputPath
          )}`;
          const chunkPath = path.join(outputDir, chunkName);
          if (fs.existsSync(chunkPath)) {
            chunkPaths.push(chunkPath);
          } else {
            console.warn(`    ⚠️ Ожидаемый чанк не найден: ${chunkName}`);
          }
        }
        if (chunkPaths.length === 0 && numChunks > 0) {
          return reject(
            new Error(`Не удалось создать ни одного чанка для ${inputPath}`)
          );
        }
        console.log(`    ✅ Файл разделен на ${chunkPaths.length} частей.`);
        resolve(chunkPaths);
      })
      .on("error", (err) => {
        reject(
          new Error(`Ошибка при разделении файла ${inputPath}: ${err.message}`)
        );
      })
      .run();
  });
}

/**
 * Transcribe one audio file using OpenAI API, handling large files.
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

  let tempDir = null;
  try {
    const { duration, size } = await getAudioMetadata(filePath);
    console.log(
      `[${index + 1}/${totalFiles}] ℹ️  Размер: ${(size / 1024 / 1024).toFixed(
        2
      )} MB, Длительность: ${Math.floor(duration / 60)}m ${Math.round(
        duration % 60
      )}s`
    );

    let transcript = "";

    if (size > MAX_FILE_SIZE) {
      console.log(
        `[${index + 1}/${totalFiles}] 🐘 Файл слишком большой (${(
          size /
          1024 /
          1024
        ).toFixed(2)} MB > ${OPENAI_API_LIMIT_MB} MB), требуется разделение.`
      );

      tempDir = fs.mkdtempSync(
        path.join(os.tmpdir(), `whisper-chunks-${Date.now()}-`)
      );
      console.log(
        `[${
          index + 1
        }/${totalFiles}] 📁 Создана временная директория: ${tempDir}`
      );

      const chunkPaths = await splitAudioFile(
        filePath,
        tempDir,
        duration,
        size,
        TARGET_CHUNK_SIZE_BYTES
      );

      if (!chunkPaths || chunkPaths.length === 0) {
        throw new Error("Не удалось разделить файл на части.");
      }

      const transcriptParts = [];
      for (let i = 0; i < chunkPaths.length; i++) {
        console.log(
          `[${index + 1}/${totalFiles}] 🎤 Обработка чанка ${i + 1} из ${
            chunkPaths.length
          }...`
        );
        const chunkPath = chunkPaths[i];
        try {
          const part = await transcribeChunk(chunkPath, OPENAI_API_KEY);
          transcriptParts.push(part);
        } catch (chunkError) {
          console.error(
            `[${index + 1}/${totalFiles}] ❌ Ошибка при обработке чанка ${
              i + 1
            }: ${chunkError.message}`
          );
          transcriptParts.push(`[ОШИБКА ОБРАБОТКИ ЧАНКА ${i + 1}]`);
        }
      }

      transcript = transcriptParts.join("\n\n");
      console.log(
        `[${
          index + 1
        }/${totalFiles}] ✅ Все части файла ${baseFilename} транскрибированы и объединены.`
      );
    } else {
      console.log(
        `[${
          index + 1
        }/${totalFiles}] 👌 Файл в пределах лимита, отправка целиком...`
      );
      transcript = await transcribeChunk(filePath, OPENAI_API_KEY);
      console.log(
        `[${
          index + 1
        }/${totalFiles}] ✅ Файл ${baseFilename} успешно транскрибирован.`
      );
    }

    fs.writeFileSync(outputPath, transcript, "utf8");
    console.log(
      `[${
        index + 1
      }/${totalFiles}] 💾 Транскрипция сохранена в: ${path.basename(
        outputPath
      )}`
    );
  } catch (error) {
    console.error(
      `[${
        index + 1
      }/${totalFiles}] ❌ Ошибка при обработке файла ${baseFilename}:`
    );
    if (error.response) {
      console.error(`   - Статус API: ${error.response.status}`);
      console.error(`   - Ответ API: ${JSON.stringify(error.response.data)}`);
    } else if (error.request) {
      console.error("   - Ошибка сети или нет ответа от сервера OpenAI.");
    } else {
      console.error(`   - ${error.message}`);
      if (error.stack) {
        console.error(error.stack);
      }
    }
  } finally {
    if (tempDir) {
      try {
        console.log(
          `[${
            index + 1
          }/${totalFiles}] 🧹 Очистка временных файлов из ${tempDir}...`
        );
        fs.rmSync(tempDir, { recursive: true, force: true });
        console.log(`[${index + 1}/${totalFiles}] ✨ Временные файлы удалены.`);
      } catch (cleanupError) {
        console.error(
          `[${
            index + 1
          }/${totalFiles}] ⚠️ Не удалось удалить временную директорию ${tempDir}: ${
            cleanupError.message
          }`
        );
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
      `[${
        index + 1
      }/${totalFiles}] ⏭️  Файл уже обработан, пропуск: ${videoBasename}`
    );
    return;
  }

  try {
    // Step 1: Extract audio if not already done
    if (!fs.existsSync(audioPath)) {
      await extractAudio(videoPath, audioPath);
    } else {
      console.log(
        `[${
          index + 1
        }/${totalFiles}] 📁 Аудио файл уже существует: ${path.basename(
          audioPath
        )}`
      );
    }

    // Step 2: Transcribe audio
    await transcribeAudioFile(audioPath, textPath, index, totalFiles);

    console.log(
      `[${index + 1}/${totalFiles}] ✅ Видео ${videoBasename} полностью обработано.`
    );
  } catch (error) {
    console.error(
      `[${
        index + 1
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
  if (!OPENAI_API_KEY) {
    console.error(
      "❌ ОШИБКА: API ключ OpenAI не найден. Убедитесь, что он задан в файле .env как OPENAI_API_KEY."
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
  for (let i = 0; i < totalFiles; i++) {
    await processVideoFile(videoFiles[i], i, totalFiles);
    console.log(`---`);
  }

  console.log(`🏁 Все файлы обработаны.`);
}

// Run main function
main().catch((err) => {
  console.error("🚫 Произошла критическая ошибка в главной функции:", err);
});
