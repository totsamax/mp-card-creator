'use strict';

// Makes the Yandex Object Storage bucket publicly readable so apiframe/Kling
// can fetch reference images via HTTPS URL.
//
// Uses bucket ACL (public-read) instead of bucket policy — Yandex Cloud's
// bucket policy is deny-by-default, which would block the service account.
// ACL is additive: it grants public read without affecting IAM permissions.
//
// Usage: node scripts/make-bucket-public.js
// Loads .env.local automatically.

const fs   = require('fs');
const path = require('path');

// Load .env.local
const envPath = path.resolve(__dirname, '../.env.local');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split(/\r?\n/).forEach(line => {
    const m = line.match(/^([^=#\s][^=]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  });
}

const {
  S3Client,
  DeleteBucketPolicyCommand,
  PutBucketAclCommand,
  GetBucketAclCommand,
} = require('@aws-sdk/client-s3');

const bucket   = process.env.YC_BUCKET_NAME  || 'mold-pipeline-output';
const endpoint = process.env.YC_ENDPOINT     || 'https://storage.yandexcloud.net';

const s3 = new S3Client({
  region:   'ru-central1',
  endpoint,
  credentials: {
    accessKeyId:     process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

async function main() {
  console.log(`Bucket: ${bucket}`);
  console.log(`Endpoint: ${endpoint}`);

  // Step 1: Remove the bucket policy that was breaking service-account access
  console.log('\nStep 1: Removing bucket policy (if any)...');
  try {
    await s3.send(new DeleteBucketPolicyCommand({ Bucket: bucket }));
    console.log('Bucket policy deleted.');
  } catch (err) {
    if (err.name === 'NoSuchBucketPolicy' || err.message?.includes('NoSuchBucketPolicy')) {
      console.log('No bucket policy to delete.');
    } else {
      console.warn('Could not delete policy:', err.message);
    }
  }

  // Step 2: Set bucket-level ACL to public-read
  // This is additive — does NOT affect IAM/service-account permissions
  console.log('\nStep 2: Setting bucket ACL to public-read...');
  await s3.send(new PutBucketAclCommand({ Bucket: bucket, ACL: 'public-read' }));
  console.log('Bucket ACL set to public-read.');

  // Step 3: Verify ACL was applied
  console.log('\nStep 3: Verifying ACL...');
  const acl = await s3.send(new GetBucketAclCommand({ Bucket: bucket }));
  const grants = acl.Grants || [];
  const hasPublicRead = grants.some(g =>
    g.Grantee?.URI === 'http://acs.amazonaws.com/groups/global/AllUsers' && g.Permission === 'READ'
  );
  console.log(`Public read grant present: ${hasPublicRead}`);
  if (!hasPublicRead) {
    console.warn('Warning: public-read grant not found in ACL response. Yandex may use a different URI.');
    console.log('Raw grants:', JSON.stringify(grants, null, 2));
  }

  console.log('\nDone. Bucket objects should now be publicly readable.');
  console.log(`Test: curl -I https://storage.yandexcloud.net/${bucket}/0001/03-images/1/M_main.png`);
}

main().catch(err => {
  console.error('Failed:', err.message);
  process.exit(1);
});
