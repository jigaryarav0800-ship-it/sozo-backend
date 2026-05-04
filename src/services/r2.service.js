const { PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const r2 = require('../config/r2');

const BUCKET     = process.env.R2_BUCKET_NAME;
const PUBLIC_URL = (process.env.R2_PUBLIC_URL || '').replace(/\/$/, '');

async function uploadBuffer(key, buffer, contentType) {
  await r2.send(new PutObjectCommand({
    Bucket:      BUCKET,
    Key:         key,
    Body:        buffer,
    ContentType: contentType,
  }));
  return `${PUBLIC_URL}/${key}`;
}

async function deleteFile(key) {
  await r2.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

async function getPresignedUploadUrl(key, contentType, expiresIn = 3600) {
  const command = new PutObjectCommand({
    Bucket:      BUCKET,
    Key:         key,
    ContentType: contentType,
  });
  const uploadUrl = await getSignedUrl(r2, command, { expiresIn });
  return { uploadUrl, key, publicUrl: `${PUBLIC_URL}/${key}` };
}

module.exports = { uploadBuffer, deleteFile, getPresignedUploadUrl };
