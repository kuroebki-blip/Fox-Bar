# План миграции OCR

Следующая итерация — отдельный `ocr-service/` на FastAPI: `POST /ocr` принимает JPEG/PNG с лимитами размера и таймаутом, присваивает request ID и возвращает текст, координаты и confidence PaddleOCR. Парсеры `iiko`, `terminal`, `invoice`, `stock_document` остаются отдельными модулями. Docker deployment не логирует содержимое документов; Gemini остаётся fallback до подтверждённого параллельного сравнения результатов.
