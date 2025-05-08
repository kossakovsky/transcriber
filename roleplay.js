import fs from "fs/promises"; // Using promises for async file operations
import path from "path";
import axios from "axios";

// Загружаем переменные окружения из .env файла
import dotenv from "dotenv";
dotenv.config();

// --- Конфигурация ---

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = "gpt-4o"; // Используем модель GPT-4o
const DELAY_BETWEEN_REQUESTS_MS = 5000; // 5 секунд задержки между запросами к API

// --- Список файлов для обработки ---
// Укажите здесь полные пути к файлам .txt, которые нужно обработать
const filesToProcess = [
  "/Users/kossakovsky/Library/CloudStorage/GoogleDrive-kossakovsky93@gmail.com/My Drive/Automatica n8n/flowise/Automatica fw lessons/Automatica_#1.txt",
];

// --- Вспомогательные функции ---

/**
 * Простая функция задержки.
 * @param {number} ms - Время задержки в миллисекундах.
 */
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Отправляет один чанк текста в OpenAI для обработки.
 * @param {string} textChunk - Часть текста для обработки.
 * @param {string} systemPrompt - Системный промпт для модели.
 * @param {number} fileIndex - Индекс основного файла.
 * @param {number} totalFiles - Общее количество файлов.
 * @param {number} chunkIndex - Индекс текущего чанка (1 or 2).
 * @param {number} totalChunks - Общее количество чанков для файла (always 2).
 * @returns {Promise<string>} - Обработанный текст чанка.
 */
async function processTextChunk(
  textChunk,
  systemPrompt,
  fileIndex,
  totalFiles,
  chunkIndex,
  totalChunks
) {
  console.log(
    `[${
      fileIndex + 1
    }/${totalFiles}] [Часть ${chunkIndex}/${totalChunks}] ☁️ Отправка в OpenAI (${OPENAI_MODEL})...`
  );
  try {
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: OPENAI_MODEL,
        messages: [
          {
            role: "system",
            content: systemPrompt,
          },
          {
            role: "user",
            content: textChunk,
          },
        ],
        temperature: 0.2,
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        timeout: 300000, // 5 минут
      }
    );

    if (
      !response.data ||
      !response.data.choices ||
      response.data.choices.length === 0 ||
      !response.data.choices[0].message ||
      !response.data.choices[0].message.content
    ) {
      throw new Error("Некорректный ответ от OpenAI API для чанка");
    }
    const processedChunk = response.data.choices[0].message.content.trim();
    console.log(
      `[${
        fileIndex + 1
      }/${totalFiles}] [Часть ${chunkIndex}/${totalChunks}] ✅ Часть успешно обработана.`
    );
    return processedChunk;
  } catch (error) {
    console.error(
      `[${
        fileIndex + 1
      }/${totalFiles}] [Часть ${chunkIndex}/${totalChunks}] ❌ Ошибка при обработке части:`
    );
    if (error.response) {
      console.error(`   - Статус API: ${error.response.status}`);
      console.error(`   - Ответ API: ${JSON.stringify(error.response.data)}`);
    } else if (error.request) {
      console.error("   - Ошибка сети или нет ответа от сервера OpenAI.");
    } else {
      console.error(`   - ${error.message}`);
    }
    // Возвращаем маркер ошибки вместо текста чанка
    return `[ОШИБКА ОБРАБОТКИ ЧАСТИ ${chunkIndex}/${totalChunks}]`;
  }
}

/**
 * Обрабатывает один файл транскрипции для разделения по ролям.
 * @param {string} filePath - Путь к файлу транскрипции (.txt).
 * @param {number} index - Порядковый номер файла.
 * @param {number} totalFiles - Общее количество файлов.
 */
async function processTranscriptFile(filePath, index, totalFiles) {
  const baseFilename = path.basename(filePath);
  const outputFilename = `${path.basename(filePath, ".txt")}_roles.txt`;
  const outputPath = path.join(path.dirname(filePath), outputFilename);

  console.log(
    `[${index + 1}/${totalFiles}] ▶️ Обработка файла: ${baseFilename}`
  );

  try {
    // Проверка существования файла перед обработкой
    try {
      await fs.access(filePath);
    } catch {
      console.error(
        `[${
          index + 1
        }/${totalFiles}] ❌ Файл не найден (проверьте путь): ${filePath}`
      );
      return; // Пропускаем этот файл
    }

    // 1. Прочитать содержимое файла
    const transcriptText = await fs.readFile(filePath, "utf8");
    if (!transcriptText.trim()) {
      console.log(
        `[${index + 1}/${totalFiles}] ⚠️ Файл ${baseFilename} пустой, пропуск.`
      );
      return;
    }
    console.log(
      `[${index + 1}/${totalFiles}] 📄 Содержимое файла прочитано (${
        transcriptText.length
      } символов).`
    );

    // 2. Сформировать промпт для OpenAI
    const systemPrompt = `Ты - эксперт по обработке текста. Твоя задача - проанализировать транскрипцию лекции и определить роли говорящих. Основной говорящий - Лектор. Иногда Студенты задают вопросы или делают комментарии, а Лектор отвечает.
Пожалуйста, обработай следующую транскрипцию лекции. Определи каждый сегмент речи и четко пометь его как [Лектор], [Студент - Вопрос], [Студент - Комментарий] или [Лектор - Ответ]. Сохраняй исходный текст и структуру как можно точнее, вставляя метки ролей перед каждым соответствующим сегментом речи.
- Если сегмент - это продолжение речи лектора, используй [Лектор].
- Если студент что-то спрашивает, используй [Студент - Вопрос].
- Если лектор прямо отвечает на этот вопрос, используй [Лектор - Ответ].
- Если студент добавляет комментарий, не являющийся прямым вопросом, используй [Студент - Комментарий].
- Если роль определить невозможно, оставь сегмент без метки или используй [Неизвестно].
Важно: Возвращай ТОЛЬКО обработанный текст с метками, без дополнительных пояснений или вступлений.`;

    // 3. Разделить текст на две части
    console.log(
      `[${index + 1}/${totalFiles}] ✂️ Разделение текста на 2 части...`
    );
    const midpoint = Math.floor(transcriptText.length / 2);
    // Ищем ближайший конец абзаца (\n\n) или предложения (. ) перед серединой
    let breakPoint = transcriptText.lastIndexOf("\n\n", midpoint);
    if (breakPoint === -1) {
      // Если нет абзацев, ищем конец предложения
      breakPoint = transcriptText.lastIndexOf(". ", midpoint);
    }
    if (
      breakPoint === -1 ||
      midpoint - breakPoint > transcriptText.length * 0.2
    ) {
      // Если не нашли подходящий разрыв или он слишком далеко, делим просто по середине
      breakPoint = midpoint;
      console.warn(
        `[${
          index + 1
        }/${totalFiles}] ⚠️ Не удалось найти хороший разрыв у середины, деление по центру.`
      );
    } else {
      // Смещаем точку разрыва после найденного разделителя (два переноса или точка с пробелом)
      breakPoint +=
        transcriptText.substring(breakPoint, breakPoint + 2) === "\n\n" ? 2 : 2;
    }

    const chunk1 = transcriptText.substring(0, breakPoint);
    const chunk2 = transcriptText.substring(breakPoint);

    if (!chunk1.trim() || !chunk2.trim()) {
      console.error(
        `[${
          index + 1
        }/${totalFiles}] ❌ Ошибка: не удалось разделить текст на две непустые части.`
      );
      // Можно попробовать отправить весь текст целиком как fallback?
      // Пока просто прерываем обработку этого файла.
      return;
    }

    console.log(
      `[${index + 1}/${totalFiles}]   - Часть 1: ${chunk1.length} символов`
    );
    console.log(
      `[${index + 1}/${totalFiles}]   - Часть 2: ${chunk2.length} символов`
    );

    // 4. Обработать каждую часть
    const processedChunks = [];

    // Обработка первой части
    const processedChunk1 = await processTextChunk(
      chunk1,
      systemPrompt,
      index,
      totalFiles,
      1,
      2
    );
    processedChunks.push(processedChunk1);

    // Задержка перед второй частью
    console.log(
      `[${index + 1}/${totalFiles}] ⏳ Пауза ${
        DELAY_BETWEEN_REQUESTS_MS / 1000
      } сек...`
    );
    await delay(DELAY_BETWEEN_REQUESTS_MS);

    // Обработка второй части
    const processedChunk2 = await processTextChunk(
      chunk2,
      systemPrompt,
      index,
      totalFiles,
      2,
      2
    );
    processedChunks.push(processedChunk2);

    // 5. Объединить результаты и сохранить
    // Use double newline as separator always for simplicity, even if one part failed
    const finalProcessedText = processedChunks.join("\n\n");

    console.log(
      `[${
        index + 1
      }/${totalFiles}] ✅ Файл ${baseFilename} полностью обработан.`
    );

    await fs.writeFile(outputPath, finalProcessedText, "utf8");
    console.log(
      `[${index + 1}/${totalFiles}] 💾 Результат сохранен в: ${outputFilename}`
    );
  } catch (error) {
    // Ошибки чтения файла или другие не связанные с API
    console.error(
      `[${
        index + 1
      }/${totalFiles}] ❌ Критическая ошибка при обработке файла ${baseFilename}:`,
      error.message
    );
    // Логгирование ошибки чанка происходит внутри processTextChunk
  }
}

/**
 * Основная функция для запуска процесса обработки транскрипций.
 */
async function main() {
  console.log(`🚀 Запуск скрипта разделения по ролям...`);

  if (!OPENAI_API_KEY) {
    console.error(
      "❌ ОШИБКА: API ключ OpenAI не найден. Убедитесь, что он задан в файле .env как OPENAI_API_KEY."
    );
    return;
  }

  // Используем предопределенный массив filesToProcess
  if (!filesToProcess || filesToProcess.length === 0) {
    console.log(
      "🟡 Список файлов для обработки (filesToProcess) пуст. Добавьте пути к .txt файлам в скрипт."
    );
    return;
  }

  console.log(`Обнаружено файлов для обработки: ${filesToProcess.length}`);

  const totalFiles = filesToProcess.length;
  for (let i = 0; i < totalFiles; i++) {
    await processTranscriptFile(filesToProcess[i], i, totalFiles);
    // Добавим задержку и между файлами на всякий случай
    if (i < totalFiles - 1) {
      console.log(`---`);
      console.log(
        `⏳ Пауза перед следующим файлом ${
          DELAY_BETWEEN_REQUESTS_MS / 1000
        } сек...`
      );
      await delay(DELAY_BETWEEN_REQUESTS_MS);
    } else {
      console.log(`---`);
    }
  }

  console.log(`🏁 Все файлы обработаны.`);
}

// Запуск основной функции
main().catch((err) => {
  console.error("🚫 Произошла критическая ошибка в главной функции:", err);
});
