import fs from "fs";
import path from "path";
import os from "os"; // Needed for temporary directory
import axios from "axios";
import FormData from "form-data";
import ffmpeg from "fluent-ffmpeg";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";

// Tell fluent-ffmpeg where to find the ffmpeg binary
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

// Загружаем переменные окружения из .env файла
import dotenv from "dotenv";
dotenv.config();

// --- Конфигурация ---

// !!! ВАЖНО: Хранить API ключ прямо в коде небезопасно.
// Рекомендуется использовать переменные окружения.
// Загружаем ключ из process.env.OPENAI_API_KEY (из файла .env)
// Убедитесь, что файл .env добавлен в .gitignore
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_API_LIMIT_MB = 25; // OpenAI API limit in MB
const CHUNK_SIZE_MB = 20; // Target chunk size in MB (slightly less than the limit)
const MAX_FILE_SIZE = OPENAI_API_LIMIT_MB * 1024 * 1024;
const TARGET_CHUNK_SIZE_BYTES = CHUNK_SIZE_MB * 1024 * 1024;

// Список файлов для транскрибации
// Генерируем пути к 5 файлам MP3
const filesToTranscribe = [
  "/Users/kossakovsky/Library/CloudStorage/GoogleDrive-kossakovsky93@gmail.com/My Drive/Automatica n8n/flowise/Automatica fw lessons/Automatica_#1.mp3",
];

// --- Функции ---

/**
 * Получает метаданные аудиофайла (длительность, размер).
 * @param {string} filePath - Путь к файлу.
 * @returns {Promise<object>} - Промис с метаданными { duration, size }.
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
 * Транскрибирует один небольшой аудиофайл (часть).
 * @param {string} filePath - Путь к аудиофайлу (или чанку).
 * @param {string} apiKey - API ключ OpenAI.
 * @returns {Promise<string>} - Промис с текстом транскрипции.
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
        // Увеличенный таймаут для обработки чанков
        timeout: 600000, // 10 минут
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
    // Возвращаем пустую строку или маркер ошибки, чтобы основной процесс мог продолжить
    return `[ОШИБКА ТРАНСКРИБАЦИИ ЧАНКА: ${chunkFilename}]`;
  }
}

/**
 * Разбивает аудиофайл на части по размеру.
 * @param {string} inputPath - Путь к исходному файлу.
 * @param {string} outputDir - Директория для сохранения чанков.
 * @param {number} duration - Общая длительность аудио в секундах.
 * @param {number} fileSize - Размер файла в байтах.
 * @param {number} targetChunkSizeBytes - Желаемый размер чанка в байтах.
 * @returns {Promise<string[]>} - Промис со списком путей к созданным чанкам.
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
    const chunkDuration = Math.floor(duration / numChunks); // Длительность одного чанка в секундах
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
        "-f segment", // Формат вывода - сегменты
        `-segment_time ${chunkDuration}`, // Длительность каждого сегмента
        "-c copy", // Копировать кодек (быстрее, без перекодирования)
        "-reset_timestamps 1", // Сброс временных меток для каждого чанка
      ])
      .output(outputPattern)
      .on("end", () => {
        // Собираем имена созданных файлов
        for (let i = 0; i < numChunks; i++) {
          const chunkName = `chunk_${String(i).padStart(3, "0")}${path.extname(
            inputPath
          )}`;
          const chunkPath = path.join(outputDir, chunkName);
          if (fs.existsSync(chunkPath)) {
            chunkPaths.push(chunkPath);
          } else {
            // Может случиться, если последний чанк короче
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
 * Транскрибирует один аудиофайл с помощью OpenAI API, обрабатывая большие файлы.
 * @param {string} filePath - Путь к аудиофайлу.
 * @param {number} index - Порядковый номер файла (для логирования).
 * @param {number} totalFiles - Общее количество файлов (для логирования).
 */
async function transcribeFile(filePath, index, totalFiles) {
  const baseFilename = path.basename(filePath);
  console.log(
    `[${index + 1}/${totalFiles}] ▶️ Начинаем обработку файла: ${baseFilename}`
  );

  let tempDir = null; // Для хранения временных чанков
  try {
    // Проверка существования файла перед обработкой
    if (!fs.existsSync(filePath)) {
      console.error(
        `[${index + 1}/${totalFiles}] ❌ Файл не найден: ${filePath}`
      );
      return; // Пропускаем этот файл
    }

    // Получаем метаданные файла
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

      // Создаем временную директорию
      tempDir = fs.mkdtempSync(
        path.join(os.tmpdir(), `whisper-chunks-${Date.now()}-`)
      );
      console.log(
        `[${
          index + 1
        }/${totalFiles}] 📁 Создана временная директория: ${tempDir}`
      );

      // Разделяем файл
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

      // Транскрибируем каждый чанк последовательно
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
          // Добавляем маркер ошибки в итоговую транскрипцию
          transcriptParts.push(`[ОШИБКА ОБРАБОТКИ ЧАНКА ${i + 1}]`);
          // Можно решить прерывать ли весь процесс или продолжать
          // continue;
        }
      }

      // Объединяем результаты
      transcript = transcriptParts.join("\n\n"); // Добавляем пустую строку между частями
      console.log(
        `[${
          index + 1
        }/${totalFiles}] ✅ Все части файла ${baseFilename} транскрибированы и объединены.`
      );
    } else {
      // Файл достаточно маленький, транскрибируем напрямую
      console.log(
        `[${
          index + 1
        }/${totalFiles}] 👌 Файл в пределах лимита, отправка целиком...`
      );
      transcript = await transcribeChunk(filePath, OPENAI_API_KEY); // Используем ту же функцию
      console.log(
        `[${
          index + 1
        }/${totalFiles}] ✅ Файл ${baseFilename} успешно транскрибирован.`
      );
    }

    // Сохранение результата в текстовый файл
    const outputFilename = `${path.basename(
      filePath,
      path.extname(filePath) // Убираем расширение из имени файла
    )}.txt`;
    const outputPath = path.join(path.dirname(filePath), outputFilename); // Сохраняем рядом с оригиналом (можно изменить)

    fs.writeFileSync(outputPath, transcript, "utf8");
    console.log(
      `[${
        index + 1
      }/${totalFiles}] 💾 Транскрипция сохранена в: ${outputFilename}`
    );
  } catch (error) {
    console.error(
      `[${
        index + 1
      }/${totalFiles}] ❌ Ошибка при обработке файла ${baseFilename}:`
    );
    if (error.response) {
      // Ошибки axios/OpenAI
      console.error(`   - Статус API: ${error.response.status}`);
      console.error(`   - Ответ API: ${JSON.stringify(error.response.data)}`);
    } else if (error.request) {
      // Ошибки сети
      console.error("   - Ошибка сети или нет ответа от сервера OpenAI.");
    } else {
      // Другие ошибки (ffmpeg, файловая система и т.д.)
      console.error(`   - ${error.message}`);
      // Логируем стек вызовов для ffmpeg и других ошибок
      if (error.stack) {
        console.error(error.stack);
      }
    }
  } finally {
    // Очистка временных файлов, если они были созданы
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
 * Основная функция для запуска процесса транскрибации всех файлов.
 */
async function main() {
  console.log(`🚀 Запуск скрипта транскрибации...`);
  console.log(`Обнаружено файлов для обработки: ${filesToTranscribe.length}`);

  if (!OPENAI_API_KEY) {
    console.error(
      "❌ ОШИБКА: API ключ OpenAI не найден. Убедитесь, что он задан в файле .env как OPENAI_API_KEY."
    );
    return; // Прерываем выполнение, так как ключ необходим
  }

  const totalFiles = filesToTranscribe.length;
  for (let i = 0; i < totalFiles; i++) {
    // Убедимся, что путь абсолютный, если он задан относительно
    // const filePath = path.resolve(filesToTranscribe[i]);
    // Используем путь как есть, т.к. он уже абсолютный в вашем примере
    const filePath = filesToTranscribe[i];
    await transcribeFile(filePath, i, totalFiles);
    console.log(`---`); // Разделитель между файлами
  }

  console.log(`🏁 Все файлы обработаны.`);
}

// Запуск основной функции
main().catch((err) => {
  console.error("🚫 Произошла критическая ошибка в главной функции:", err);
});
