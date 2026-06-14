#!/usr/bin/env bash
# Деплой mp-card-creator на Yandex Cloud.
# Зависимости: yc CLI (0.199+), jq, aws CLI
# Запуск: source infra/env.sh && bash infra/deploy.sh

set -euo pipefail

# aws CLI может быть установлен через pip3 и не быть в PATH
AWS="${AWS:-/Users/maksimkorovin/Library/Python/3.9/bin/aws}"
YMQ_ENDPOINT="https://message-queue.api.cloud.yandex.net"
S3_ENDPOINT="https://storage.yandexcloud.net"

# ---------------------------------------------------------------------------
# §0 — Проверка переменных
# ---------------------------------------------------------------------------
required_vars=(YC_FOLDER_ID YC_SERVICE_ACCOUNT_ID AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY
               OPENAI_API_KEY ANTHROPIC_API_KEY YDB_DATABASE_NAME YDB_TABLE_NAME
               S3_BUCKET_NAME FRONTEND_BUCKET YMQ_TEXTS_QUEUE YMQ_IMAGES_QUEUE
               YMQ_VIDEO_QUEUE FUNCTIONS_PREFIX LAYER_NAME API_GATEWAY_NAME)
for v in "${required_vars[@]}"; do
  [[ -z "${!v:-}" ]] && { echo "ERROR: $v не задан. source infra/env.sh"; exit 1; }
done
: "${KLING_API_KEY:=}"

echo "=== mp-card-creator deploy ==="
echo "Folder: $YC_FOLDER_ID | Prefix: $FUNCTIONS_PREFIX"
echo ""

# ---------------------------------------------------------------------------
# §1 — Сборка zip-архивов
# Layers не поддерживаются в yc 0.199 — пакуем shared + node_modules в каждую функцию.
# ---------------------------------------------------------------------------
echo "[1/9] Сборка zip-архивов..."
rm -rf deploy/ && mkdir -p deploy/

# Базовый архив: shared/ + node_modules/ (один раз)
echo -n "  base (shared + node_modules)... "
zip -qr deploy/base.zip layers/shared/ node_modules/ -x "*.DS_Store" -x "deploy/*"
# Переименовываем shared → чтобы лежал рядом с index.js (SHARED_LAYER_PATH=/function/code/shared)
# Структура в zip: shared/, node_modules/, index.js
echo "$(du -sh deploy/base.zip | cut -f1)"

# Для каждой функции: копируем base.zip, добавляем index.js
for func in api step-normalize step-texts step-images step-video step-excel step-assemble; do
  echo -n "  $func... "
  cp deploy/base.zip "deploy/$func.zip"
  if [[ "$func" == "api" ]]; then
    # api zip includes step-excel and step-assemble for direct (sync) invocation
    cp functions/step-excel/index.js /tmp/step-excel.js
    cp functions/step-assemble/index.js /tmp/step-assemble.js
    zip -qj "deploy/$func.zip" "functions/$func/index.js" /tmp/step-excel.js /tmp/step-assemble.js
  else
    # -j: junk paths → index.js окажется в корне архива
    zip -qj "deploy/$func.zip" "functions/$func/index.js"
  fi
  echo "$(du -sh "deploy/$func.zip" | cut -f1)"
done

# ---------------------------------------------------------------------------
# §2 — YDB: создать БД и таблицу
# ---------------------------------------------------------------------------
echo "[2/9] YDB..."
yc ydb database create "$YDB_DATABASE_NAME" --serverless 2>/dev/null || true

echo -n "  Ожидание RUNNING"
for i in $(seq 1 30); do
  status=$(yc ydb database get "$YDB_DATABASE_NAME" --format json 2>/dev/null | jq -r '.status // "unknown"')
  [[ "$status" == "RUNNING" ]] && break
  echo -n "."; sleep 5
done
echo " $status"

YDB_ENDPOINT=$(yc ydb database get "$YDB_DATABASE_NAME" --format json | jq -r '.document_api_endpoint')
echo "  Document API: $YDB_ENDPOINT"

AWS_DEFAULT_REGION=ru-central1 \
AWS_ACCESS_KEY_ID="$AWS_ACCESS_KEY_ID" \
AWS_SECRET_ACCESS_KEY="$AWS_SECRET_ACCESS_KEY" \
"$AWS" dynamodb create-table \
  --endpoint-url "$YDB_ENDPOINT" \
  --table-name "$YDB_TABLE_NAME" \
  --attribute-definitions AttributeName=article,AttributeType=S \
  --key-schema AttributeName=article,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST > /dev/null 2>&1 \
  && echo "  Таблица $YDB_TABLE_NAME создана" \
  || echo "  Таблица $YDB_TABLE_NAME уже существует"

# ---------------------------------------------------------------------------
# §3 — Object Storage: бакеты
# ---------------------------------------------------------------------------
echo "[3/9] Object Storage..."
yc storage bucket create --name "$S3_BUCKET_NAME" 2>/dev/null \
  && echo "  $S3_BUCKET_NAME создан" || echo "  $S3_BUCKET_NAME уже существует"
yc storage bucket create --name "$FRONTEND_BUCKET" 2>/dev/null \
  && echo "  $FRONTEND_BUCKET создан" || echo "  $FRONTEND_BUCKET уже существует"
yc storage bucket update "$FRONTEND_BUCKET" --public-read > /dev/null
# website-settings через S3-совместимый API (yc storage не поддерживает правильный формат)
AWS_DEFAULT_REGION=ru-central1 \
AWS_ACCESS_KEY_ID="$AWS_ACCESS_KEY_ID" \
AWS_SECRET_ACCESS_KEY="$AWS_SECRET_ACCESS_KEY" \
"$AWS" s3api put-bucket-website \
  --endpoint-url "$S3_ENDPOINT" \
  --bucket "$FRONTEND_BUCKET" \
  --website-configuration '{"IndexDocument":{"Suffix":"index.html"},"ErrorDocument":{"Key":"index.html"}}' > /dev/null
echo "  Static hosting включён: https://$FRONTEND_BUCKET.website.yandexcloud.net"

# ---------------------------------------------------------------------------
# §4 — YMQ: три очереди
# ---------------------------------------------------------------------------
echo "[4/9] Message Queue..."
ymq() {
  AWS_DEFAULT_REGION=ru-central1 \
  AWS_ACCESS_KEY_ID="$AWS_ACCESS_KEY_ID" \
  AWS_SECRET_ACCESS_KEY="$AWS_SECRET_ACCESS_KEY" \
  "$AWS" --endpoint-url "$YMQ_ENDPOINT" "$@"
}

for q in "$YMQ_TEXTS_QUEUE" "$YMQ_IMAGES_QUEUE" "$YMQ_VIDEO_QUEUE"; do
  ymq sqs create-queue --queue-name "$q" > /dev/null 2>&1 \
    && echo "  $q создана" || echo "  $q уже существует"
done

YMQ_TEXTS_URL=$(ymq sqs get-queue-url --queue-name "$YMQ_TEXTS_QUEUE" | jq -r '.QueueUrl')
YMQ_IMAGES_URL=$(ymq sqs get-queue-url --queue-name "$YMQ_IMAGES_QUEUE" | jq -r '.QueueUrl')
YMQ_VIDEO_URL=$(ymq sqs get-queue-url --queue-name "$YMQ_VIDEO_QUEUE" | jq -r '.QueueUrl')
echo "  Texts:  $YMQ_TEXTS_URL"
echo "  Images: $YMQ_IMAGES_URL"
echo "  Video:  $YMQ_VIDEO_URL"

# ---------------------------------------------------------------------------
# §5 — Cloud Functions (7 штук)
# ---------------------------------------------------------------------------
echo "[5/9] Cloud Functions..."

COMMON_ENV="STORE_ADAPTER=yandex-cloud,\
SHARED_LAYER_PATH=/function/code/layers/shared,\
YDB_DOCUMENT_API_ENDPOINT=$YDB_ENDPOINT,\
YDB_TABLE_NAME=$YDB_TABLE_NAME,\
YC_BUCKET_NAME=$S3_BUCKET_NAME,\
YC_ENDPOINT=$S3_ENDPOINT,\
AWS_ACCESS_KEY_ID=$AWS_ACCESS_KEY_ID,\
AWS_SECRET_ACCESS_KEY=$AWS_SECRET_ACCESS_KEY,\
YMQ_TEXTS_QUEUE_URL=$YMQ_TEXTS_URL,\
YMQ_IMAGES_QUEUE_URL=$YMQ_IMAGES_URL,\
YMQ_VIDEO_QUEUE_URL=$YMQ_VIDEO_URL,\
OPENAI_API_KEY=$OPENAI_API_KEY,\
ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY,\
KLING_API_KEY=$KLING_API_KEY"

S3_FN_PREFIX="functions-deploy"

deploy_fn() {
  local name=$1 zip=$2 mem=$3 timeout=$4
  local full="${FUNCTIONS_PREFIX}-${name}"
  local s3_key="${S3_FN_PREFIX}/${zip}.zip"

  # Загрузить zip в S3 (размер > 3.5MB — прямая загрузка не работает)
  AWS_DEFAULT_REGION=ru-central1 \
  AWS_ACCESS_KEY_ID="$AWS_ACCESS_KEY_ID" \
  AWS_SECRET_ACCESS_KEY="$AWS_SECRET_ACCESS_KEY" \
  "$AWS" s3 cp "deploy/${zip}.zip" "s3://$S3_BUCKET_NAME/$s3_key" \
    --endpoint-url "$S3_ENDPOINT" --quiet

  yc serverless function create --name "$full" > /dev/null 2>&1 || true
  yc serverless function version create \
    --function-name "$full" \
    --runtime nodejs18 \
    --entrypoint index.handler \
    --memory "${mem}m" \
    --execution-timeout "${timeout}s" \
    --package-bucket-name "$S3_BUCKET_NAME" \
    --package-object-name "$s3_key" \
    --service-account-id "$YC_SERVICE_ACCOUNT_ID" \
    --environment "$COMMON_ENV" > /dev/null
  local id; id=$(yc serverless function get "$full" --format json | jq -r '.id')
  echo "  ✓ $full  [$id]"
}

deploy_fn api            api            256  30
deploy_fn step-normalize step-normalize 256  30
deploy_fn step-texts     step-texts     512  60
deploy_fn step-images    step-images    512  120
deploy_fn step-video     step-video     256  30
deploy_fn step-excel     step-excel     512  60
deploy_fn step-assemble  step-assemble  256  30

API_FUNC_ID=$(yc serverless function get "${FUNCTIONS_PREFIX}-api" --format json | jq -r '.id')
echo "  API Function ID: $API_FUNC_ID"

# ---------------------------------------------------------------------------
# §6 — API Gateway
# ---------------------------------------------------------------------------
echo "[6/9] API Gateway..."
sed "s/\${API_FUNCTION_ID}/$API_FUNC_ID/g" infra/api-gateway.yaml > /tmp/mp-gw-spec.yaml

if yc serverless api-gateway get "$API_GATEWAY_NAME" > /dev/null 2>&1; then
  yc serverless api-gateway update --name "$API_GATEWAY_NAME" --spec /tmp/mp-gw-spec.yaml > /dev/null
  echo "  Обновлён"
else
  yc serverless api-gateway create --name "$API_GATEWAY_NAME" --spec /tmp/mp-gw-spec.yaml > /dev/null
  echo "  Создан"
fi
GW_DOMAIN=$(yc serverless api-gateway get "$API_GATEWAY_NAME" --format json | jq -r '.domain')
echo "  URL: https://$GW_DOMAIN"

# ---------------------------------------------------------------------------
# §7 — YMQ Triggers
# ---------------------------------------------------------------------------
echo "[7/9] YMQ Triggers..."

create_trigger() {
  local tname=$1 queue_url=$2 fname=$3
  local full_t="${FUNCTIONS_PREFIX}-trigger-${tname}"
  local func_id; func_id=$(yc serverless function get "${FUNCTIONS_PREFIX}-${fname}" --format json | jq -r '.id')
  # Получаем ARN очереди и строим queue_id в формате folder_id/queue_name
  local queue_arn
  queue_arn=$(AWS_DEFAULT_REGION=ru-central1 \
    AWS_ACCESS_KEY_ID="$AWS_ACCESS_KEY_ID" \
    AWS_SECRET_ACCESS_KEY="$AWS_SECRET_ACCESS_KEY" \
    "$AWS" sqs get-queue-attributes \
      --endpoint-url "$YMQ_ENDPOINT" \
      --queue-url "$queue_url" \
      --attribute-names QueueArn | jq -r '.Attributes.QueueArn')
  local queue_id="$queue_arn"

  if yc serverless trigger get "$full_t" > /dev/null 2>&1; then
    echo "  $full_t уже существует"
    return
  fi
  yc serverless trigger create message-queue "$full_t" \
    --queue "$queue_id" \
    --queue-service-account-id "$YC_SERVICE_ACCOUNT_ID" \
    --invoke-function-id "$func_id" \
    --invoke-function-service-account-id "$YC_SERVICE_ACCOUNT_ID" \
    --batch-size 1 \
    --batch-cutoff 10s > /dev/null
  echo "  ✓ $full_t → ${FUNCTIONS_PREFIX}-${fname}"
}

create_trigger texts  "$YMQ_TEXTS_URL"  step-texts
create_trigger images "$YMQ_IMAGES_URL" step-images
create_trigger video  "$YMQ_VIDEO_URL"  step-video

# ---------------------------------------------------------------------------
# §8 — Фронтенд (build + upload)
# ---------------------------------------------------------------------------
echo "[8/9] Фронтенд..."
VITE_API_BASE_URL="https://$GW_DOMAIN" npm run --prefix frontend build > /dev/null 2>&1
echo "  Build OK"

AWS_DEFAULT_REGION=ru-central1 \
AWS_ACCESS_KEY_ID="$AWS_ACCESS_KEY_ID" \
AWS_SECRET_ACCESS_KEY="$AWS_SECRET_ACCESS_KEY" \
"$AWS" s3 sync frontend/dist/ "s3://$FRONTEND_BUCKET/" \
  --endpoint-url "$S3_ENDPOINT" \
  --delete \
  --quiet
echo "  Frontend: https://$FRONTEND_BUCKET.website.yandexcloud.net"

# ---------------------------------------------------------------------------
# §9 — Публичный доступ: API Gateway может вызывать функцию без аутентификации
# ---------------------------------------------------------------------------
echo "[9/9] IAM: публичный invoke для API функции..."
yc serverless function add-access-binding \
  --name "${FUNCTIONS_PREFIX}-api" \
  --role serverless.functions.invoker \
  --subject system:allUsers > /dev/null 2>&1 || true
echo "  OK"

echo ""
echo "=== Деплой завершён ==="
echo "API:      https://$GW_DOMAIN"
echo "Frontend: https://$FRONTEND_BUCKET.website.yandexcloud.net"
echo ""
echo "Проверка: curl https://$GW_DOMAIN/lines"
