'use strict';

// Usage: node scripts/delete-line.js <article>
// Loads .env.local automatically, then deletes the YDB manifest record.
// S3 artifacts are NOT deleted (they stay in Object Storage under the same article key).

const fs   = require('fs');
const path = require('path');

const envPath = path.resolve(__dirname, '../.env.local');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split(/\r?\n/).forEach(line => {
    const m = line.match(/^([^=#\s][^=]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  });
}

const article = process.argv[2];
if (!article) {
  console.error('Usage: node scripts/delete-line.js <article>');
  process.exit(1);
}

async function main() {
  const { DynamoDBClient }         = require('@aws-sdk/client-dynamodb');
  const { DynamoDBDocumentClient, GetCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');

  const client = DynamoDBDocumentClient.from(new DynamoDBClient({
    region:   'ru-central1',
    endpoint: process.env.YDB_DOCUMENT_API_ENDPOINT,
    credentials: {
      accessKeyId:     process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  }));

  const TABLE = process.env.YDB_TABLE_NAME || 'mold-manifests';

  // Check it exists first
  const existing = await client.send(new GetCommand({ TableName: TABLE, Key: { article } }));
  if (!existing.Item) {
    console.log(`Article "${article}" not found in YDB — nothing to delete.`);
    process.exit(0);
  }

  console.log(`Found article "${article}" in YDB. Deleting...`);
  await client.send(new DeleteCommand({ TableName: TABLE, Key: { article } }));
  console.log(`Done. Article "${article}" removed from YDB.`);
  console.log('Note: S3 artifacts (images, xlsx, etc.) are preserved under the same article key.');
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
