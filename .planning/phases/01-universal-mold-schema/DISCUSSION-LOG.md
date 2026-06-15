# Discussion Log — Phase 1: Universal Mold Schema

**Date:** 2026-06-15

## Gray Areas Discussed

### 1. faceSize → moldSize

**Question:** Переименовать `faceSize` в `moldSize` или сохранить `faceSize` как алиас?

**Decision:** Переименовать везде в `moldSize`. Никакого backward-compat — проект в разработке.

**Rationale:** Единообразие важнее; старых данных нет.

---

### 2. Загрузка фотографий молда

**Question:** Как фото молда попадают в пайплайн? Отдельный endpoint, часть опросника, что-то другое?

**Decision:**
- Поле `renders` → `photos`, стало обязательным (`required`)
- `POST /lines` принимает `multipart/form-data`
- Файлы загружаются в Yandex Object Storage, URL записывается в questionnaire

---

### 3. template.master.json — параметризация под типы молда

**Question:** Как параметризировать `static.topic`, `static.purpose`, `titleFull`, `annotation` под разные типы молда?

**Decision:** moldTypes + LLM для вариаций
- В `template.master.json` добавляется секция `moldTypes` с базовыми значениями `topic`, `purpose`, `titleFull`, `annotation` для каждого типа (face/hands/shoes/other)
- `templateEngine.js` выбирает нужный блок по `questionnaire.moldType`
- LLM в `step-texts` получает `topic` и `purpose` как контекст и адаптирует тексты под конкретный молд

---

### 4. UI форма создания карточки

**Question:** Как должна выглядеть форма создания новой карточки вместо хардкода?

**Decision:** Modal / drawer поверх списка карточек.

**Форма содержит:**
- Текстовые поля: moldName, article, brand, theme, color
- Число: priceBaseM
- Select: moldType (Лицо / Руки / Обувь / Другое)
- Загрузка файлов: photos (multiple, image/*)
- Таблица 5 строк sizes: XS/S/M/L/XL × {moldSize, moldLength, moldWidth, moldHeight, moldWeight}

**Отправка:** FormData (`multipart/form-data`)
