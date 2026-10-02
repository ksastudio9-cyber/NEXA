import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { CreateBucketCommand, DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { RekognitionClient } from '@aws-sdk/client-rekognition';

export const prisma = new PrismaClient();
export const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', { lazyConnect: true, maxRetriesPerRequest: 1 });
const storageProvider = process.env.S3_PROVIDER || 'minio';
if (!['aws', 'minio'].includes(storageProvider)) throw new Error('S3_PROVIDER must be aws or minio');
for (const key of ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN']) {
  if (process.env[key] !== undefined && !process.env[key].trim()) delete process.env[key];
}
if (Boolean(process.env.AWS_ACCESS_KEY_ID) !== Boolean(process.env.AWS_SECRET_ACCESS_KEY)) throw new Error('AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY must be configured together');
const storageCredentials = storageProvider === 'aws'
  ? process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
    ? { accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY, ...(process.env.AWS_SESSION_TOKEN ? { sessionToken: process.env.AWS_SESSION_TOKEN } : {}) }
    : undefined
  : process.env.S3_ACCESS_KEY && process.env.S3_SECRET_KEY
    ? { accessKeyId: process.env.S3_ACCESS_KEY, secretAccessKey: process.env.S3_SECRET_KEY }
    : { accessKeyId: process.env.MINIO_ACCESS_KEY || 'nexa-local', secretAccessKey: process.env.MINIO_SECRET_KEY || 'local-storage-dev-only' };
export const s3 = new S3Client({
  ...(storageProvider === 'aws' ? {} : { endpoint: process.env.S3_ENDPOINT || `${process.env.MINIO_ENDPOINT || 'http://localhost'}:${process.env.MINIO_PORT || '9000'}`, forcePathStyle: true }),
  region: process.env.S3_REGION || process.env.AWS_REGION || 'us-east-1',
  ...(storageCredentials ? { credentials: storageCredentials } : {})
});
export const moderationS3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
export const rekognition = new RekognitionClient({ region: process.env.AWS_REGION || 'us-east-1' });

export { CreateBucketCommand, DeleteObjectCommand, GetObjectCommand, PutObjectCommand };

export async function connectServices() {
  await prisma.$connect();
  await redis.connect();
  const bucket = process.env.S3_BUCKET || process.env.MINIO_BUCKET || 'nexa-media';
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch (error) {
    const shouldCreateBucket = process.env.S3_CREATE_BUCKET === 'true' || (!process.env.S3_CREATE_BUCKET && storageProvider === 'minio');
    if (!shouldCreateBucket) throw error;
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
  }
  return { bucket };
}

export async function disconnectServices() {
  await Promise.allSettled([prisma.$disconnect(), redis.quit()]);
}
