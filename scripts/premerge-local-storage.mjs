import assert from 'node:assert/strict';
import S3 from 'aws-sdk/clients/s3.js';

const { R2_ENDPOINT, R2_UPLOAD_KEY, R2_UPLOAD_SECRET, R2_UPLOAD_BUCKET, NEXT_PUBLIC_BASEURL } = process.env;
assert.equal(process.env.PREMERGE_LOCAL, '1');
assert.equal(new URL(R2_ENDPOINT).hostname, '127.0.0.1');
assert.equal(new URL(NEXT_PUBLIC_BASEURL).hostname, '127.0.0.1');
assert.equal(R2_UPLOAD_BUCKET, 'premerge-attachments');

const s3 = new S3({
  endpoint: R2_ENDPOINT,
  region: 'auto',
  credentials: { accessKeyId: R2_UPLOAD_KEY, secretAccessKey: R2_UPLOAD_SECRET },
  s3ForcePathStyle: true,
  signatureVersion: 'v4',
});
await s3.createBucket({ Bucket: R2_UPLOAD_BUCKET }).promise();
await s3.putBucketPolicy({
  Bucket: R2_UPLOAD_BUCKET,
  Policy: JSON.stringify({
    Version: '2012-10-17',
    Statement: [{ Effect: 'Allow', Principal: '*', Action: ['s3:GetObject'], Resource: [`arn:aws:s3:::${R2_UPLOAD_BUCKET}/*`] }],
  }),
}).promise();
await s3.headBucket({ Bucket: R2_UPLOAD_BUCKET }).promise();
const cors = await fetch(`${R2_ENDPOINT}/${R2_UPLOAD_BUCKET}/cors-probe`, {
  method: 'OPTIONS',
  headers: { Origin: NEXT_PUBLIC_BASEURL, 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'content-type' },
});
assert.equal(cors.status, 204);
assert.equal(cors.headers.get('access-control-allow-origin'), NEXT_PUBLIC_BASEURL);
assert.ok(cors.headers.get('access-control-allow-methods')?.includes('PUT'));
