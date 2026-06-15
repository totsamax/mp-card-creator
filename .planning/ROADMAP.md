# Roadmap: mp-card-creator

## Overview

The pipeline skeleton is built but has never run end-to-end. Five phases close the gap between "code exists" and "залил опросник + фото → получил готовый пакет": Phase 1 makes the schema universal, Phase 2 fixes text generation and the local retry loop, Phase 3 brings image generation to life, Phase 4 connects the UI to real API data, Phase 5 validates everything together with a real questionnaire.

## Phases

- [ ] **Phase 1: Universal Mold Schema** - Опросник принимает любой тип молда и фото как обязательные поля
- [ ] **Phase 2: Working Texts Step** - Тексты генерируются для реального типа молда, critic loop работает локально
- [ ] **Phase 3: Working Images Step** - Шаг 03-images запускается, слайды генерируются, сохраняются и видны в UI
- [ ] **Phase 4: Connected Frontend** - UI показывает реальные данные из API, статусы шагов, ошибки
- [ ] **Phase 5: E2E Validation** - Полный прогон pipeline конец-в-конец без ручного вмешательства

## Phase Details

### Phase 1: Universal Mold Schema
**Goal**: Пользователь может описать молд любого типа и приложить фото через форму опросника
**Mode:** mvp
**Depends on**: Nothing (first phase)
**Requirements**: INP-01, INP-02, INP-03
**Success Criteria** (what must be TRUE):
  1. Форма опросника содержит поле выбора типа молда (лицо / руки / обувь / другое) — значение сохраняется в опроснике
  2. Форма опросника позволяет загрузить минимум одно фото молда — фото передаётся в API при создании карточки
  3. template.master.json принимает `moldType` как параметр, а не как отдельный шаблон — все 5 размеров вычисляются независимо от типа молда
  4. POST /lines с полями `moldType` и `photos` создаёт карточку без ошибки
**Plans**: 4 plans
Plans:
- [ ] 01-01-PLAN.md — Wave 0: тест-раннер node:test, установка busboy (legitimacy gate), падающие E2E-тесты (контракт фазы)
- [ ] 01-02-PLAN.md — Схема + данные: moldType/photos/moldSize в schema, секция moldTypes, templateEngine fallback
- [ ] 01-03-PLAN.md — Multipart POST /lines: busboy в адаптере, сохранение фото через versionStore, sanitize filename
- [ ] 01-04-PLAN.md — Форма опросника: select типа молда, загрузка фото, FormData-отправка (vertical slice end-to-end)

### Phase 2: Working Texts Step
**Goal**: Тексты для всех 5 размеров генерируются с учётом типа молда, а critic loop реально повторяет попытки локально
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: TXT-01, TXT-02, TXT-03
**Success Criteria** (what must be TRUE):
  1. Запуск шага 02-texts для статьи с `moldType=hands` генерирует тексты, не упоминающие «лицо»
  2. Все 5 размеров (XS–XL) получают файлы `{size}_texts.json` в output/
  3. Если критик отклонил текст (ok: false), handler вызывает себя повторно напрямую — без YMQ URL — до 3 попыток
  4. Манифест содержит запись `attempts[]` с результатом каждой попытки (включая verdict критика)
**Plans**: TBD

### Phase 3: Working Images Step
**Goal**: Нажатие кнопки в UI запускает генерацию инфографических слайдов, которые сохраняются и отображаются
**Mode:** mvp
**Depends on**: Phase 2
**Requirements**: IMG-01, IMG-02, IMG-03, IMG-04
**Success Criteria** (what must be TRUE):
  1. Нажатие "Генерировать изображения" в UI отправляет POST /lines/:id/steps/03-images/regenerate и получает 202
  2. После завершения шага в output/ появляются PNG-файлы слайдов (минимум 1 слайд на размер)
  3. Фото молда из опросника используется как reference-изображение в промпте генерации — это видно в промпте, переданном в OpenAI API
  4. Изображения доступны в UI через GET /lines/:id/steps/03-images/artifacts/:name
**Plans**: TBD
**UI hint**: yes

### Phase 4: Connected Frontend
**Goal**: UI показывает реальные данные из API — без хардкода, со статусами шагов и видимыми ошибками
**Mode:** mvp
**Depends on**: Phase 3
**Requirements**: UI-01, UI-02, UI-03, REL-01
**Success Criteria** (what must be TRUE):
  1. Список карточек в UI загружается из GET /lines — создание новой карточки через форму добавляет её в список без перезагрузки страницы
  2. Тексты и изображения карточки берутся из API, а не из хардкодных констант LINES/TEXTS/IMAGES в PipelineApp.jsx
  3. Шаг, завершившийся с ошибкой, отображается в UI как «упал» (не «запущен» и не «готов»)
  4. Когда шаг падает, манифест содержит поля `error` и `failedAt` — UI читает их для отображения статуса
**Plans**: TBD
**UI hint**: yes

### Phase 5: E2E Validation
**Goal**: Реальный опросник с фото проходит все 6 шагов pipeline и производит готовый пакет артефактов
**Mode:** mvp
**Depends on**: Phase 4
**Requirements**: REL-02
**Success Criteria** (what must be TRUE):
  1. Отправка реального опросника (статья 0553 или новая) через UI создаёт карточку и запускает шаги 01–05 последовательно без ручного вмешательства
  2. После завершения шага 06-assemble в output/ находится полный пакет: master-data.json, тексты, слайды, ozon.xlsx, wb.xlsx
  3. Ни один шаг не падает и не остаётся в статусе «запущен» бесконечно — каждый шаг завершается со статусом «готов» или «упал» в манифесте
**Plans**: TBD

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Universal Mold Schema | 0/4 | Planned | - |
| 2. Working Texts Step | 0/TBD | Not started | - |
| 3. Working Images Step | 0/TBD | Not started | - |
| 4. Connected Frontend | 0/TBD | Not started | - |
| 5. E2E Validation | 0/TBD | Not started | - |
