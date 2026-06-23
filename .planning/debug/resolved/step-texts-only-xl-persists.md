---
slug: step-texts-only-xl-persists
status: resolved
trigger: "в процессе генерации текста, он поочередно отображается во всех размерах, но остается только в последнем"
created: 2026-06-23
updated: 2026-06-23
---

## Symptoms

- **Expected:** Тексты для всех 5 размеров (XS–XL) сохраняются в манифест
- **Actual:** При генерации тексты последовательно появляются для всех размеров в UI, но после завершения остаётся только последний размер (XL)
- **Errors:** Не проверялись
- **Timeline:** Неизвестно — первый раз тестировал
- **Reproduction:** Запустить шаг 02-texts для любой линейки

## Current Focus

hypothesis: "Каждый размер пишет артефакт в СВОЮ версию (v1..v5), т.к. step-texts инкрементит nextVersion на каждый размер. handleGetStep листит артефакты только в currentVersion (= последняя = v5), где лежит только XL_texts.json."
test: "Прочитать step-texts (nextVersion logic), api handleGetStep (listArtifacts по currentVersion), versionStore (artifactPath версионируется по vN)."
expecting: "v5/ содержит только XL → фронт видит только XL"
next_action: "Применить фикс: все размеры одного запуска пишут в ОДНУ версию"

reasoning_checkpoint:
  hypothesis: "step-texts вызывает handler по одному размеру за раз; каждый вызов делает nextVersion = currentVersion+1 и putArtifact в output/{article}/02-texts/v{N}/{size}_texts.json. Артефакты версионируются по папкам vN. После XL currentVersion=5, а v5/ содержит ТОЛЬКО XL_texts.json. handleGetStep листит артефакты по currentVersion → видит только XL."
  confirming_evidence:
    - "step-texts/index.js:63 nextVersion = (stepMeta?.currentVersion ?? 0) + 1 — растёт на каждый размер"
    - "step-texts/index.js:67-71 putArtifact(article, STEP_ID, nextVersion, `${size}_texts.json`, ...) — пишет в свою версию"
    - "versionStore.js:15-17 artifactPath: output/{article}/{stepId}/v{version}/{name} — версия = отдельная папка"
    - "api/index.js:294-295 handleGetStep: version = stepMeta.currentVersion; listArtifacts(article, stepId, version) — только последняя версия"
    - "api/index.js:64 runLocally обрабатывает размеры последовательно (for await) → версии 1..5 идут по очереди, currentVersion в итоге 5"
    - "frontend/PipelineApp.jsx:247,251 фронт запрашивает /steps/02-texts без version → получает только артефакты currentVersion"
  falsification_test: "Если бы все 5 размеров писались в одну версию, listArtifacts(currentVersion) вернул бы 5 файлов. Текущая логика гарантирует 1 файл на версию → ровно симптом."
  fix_rationale: "Все размеры одного прогона шага должны делить ОДНУ версию. Версия определяется один раз на прогон (не на размер). Тогда v{N}/ содержит XS..XL_texts.json и handleGetStep вернёт все 5."
  blind_spots: "Параллельный режим YMQ: при конкурентных вызовах read-merge-write манифеста имеет TOCTOU. Фикс должен корректно работать и при последовательном локальном прогоне (основной кейс). Кэш-проверка по inputHash (attempt===1) должна учитывать новую модель версий."

## Evidence

- timestamp: 2026-06-23
  checked: "step-texts/index.js handler — логика версии и записи артефакта"
  found: "nextVersion = (stepMeta?.currentVersion ?? 0) + 1 (стр.63). putArtifact пишет {size}_texts.json в эту версию (стр.67-71). Каждый размер вызывается отдельным сообщением → каждый инкрементит версию."
  implication: "5 размеров → 5 версий, по одному файлу в каждой."

- timestamp: 2026-06-23
  checked: "api/index.js runLocally + handleGetStep"
  found: "runLocally (стр.63-79) обрабатывает messages последовательно (for...await). handleGetStep (стр.294-295) version = stepMeta.currentVersion; listArtifacts только этой версии."
  implication: "После XL currentVersion=5. Фронт/handleGetStep листит v5 → только XL_texts.json. Не concurrency-баг, а версионирование per-size."

- timestamp: 2026-06-23
  checked: "versionStore.js artifactPath + frontend/PipelineApp.jsx"
  found: "artifactPath версионирует по папке v{version} (стр.15-17). Фронт (стр.247) GET /steps/02-texts без version, маппит артефакты в bySize (стр.251) — получает только то, что в currentVersion."
  implication: "Подтверждает: остальные размеры физически в v1..v4, но не видны, т.к. currentVersion=v5."

## Eliminated

- hypothesis: "Concurrency race в updateManifest (read-merge-write) затирает записи размеров"
  evidence: "runLocally обрабатывает размеры строго последовательно (for await). История в манифесте накапливается корректно (history: [...prev, entry]). Проблема не в манифесте, а в том, что каждый размер пишет артефакт в отдельную версию-папку, а handleGetStep листит только currentVersion."
  timestamp: 2026-06-23

## Resolution

root_cause: "step-texts инкрементит версию на КАЖДЫЙ размер: nextVersion = currentVersion+1 вызывается отдельно для XS,S,M,L,XL → артефакты ложатся в разные папки v1..v5 (по одному файлу в каждой). handleGetStep листит артефакты только в stepMeta.currentVersion (=v5), где лежит исключительно XL_texts.json. Остальные размеры существуют в v1..v4, но не видны фронту."
fix: "Закрепить версию прогона один раз в handleRegenerate (api) и пробросить runVersion в каждое сообщение размеров. step-texts использует msg.runVersion, если он есть, вместо инкремента per-size. Тогда XS..XL пишут в одну папку v{N}, а handleGetStep листит её целиком — видны все 5 размеров. Также убирает TOCTOU-гонку выбора версии."
verification: "Воспроизведено старое поведение (per-size инкремент): currentVersion=5, в v5 только XL_texts.json. После фикса (runVersion проброшен через handleRegenerate → step-texts): все XS..XL пишут в v1, handleGetStep возвращает все 5 артефактов и data-ключей. Тест: STORE_ADAPTER=local + USE_STUB=true, прогон api.handler regenerate + handleGetStep → PASS: all 5 sizes visible."
files_changed: "functions/api/index.js, functions/step-texts/index.js"
