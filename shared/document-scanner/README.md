# Document scanner

Общий browser-модуль подготовки документов. В первой итерации подключён только к FO’X; Tatooine остаётся на прежнем пути.

`new DocumentScanner({ maxLongSide: 1800 }).process(file, labels)` возвращает после подтверждения `{ confirmed, blob, width, height, filter, corners, documentDetected, usedOriginal, quality }`.

OpenCV.js 4.10.0 загружается лениво и один раз. При ошибке CDN, нехватке памяти или ненайденных границ пользователь всё равно может подтвердить исходное изображение. Ручная корректировка углов — следующая итерация.
