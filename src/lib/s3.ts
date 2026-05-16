import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import path from 'path';
import { env } from '~/config/env.config';

let client: S3Client | null = null;

function getClient(): S3Client {
  if (!client) {
    client = new S3Client({
      region: env.awsRegion,
      credentials: {
        accessKeyId: env.awsAccessKeyId,
        secretAccessKey: env.awsSecretAccessKey,
      },
    });
  }
  return client;
}

export function isS3Enabled(): boolean {
  return env.isS3Configured;
}

/** Stable key under bucket, e.g. `uploads/productImages/173-xxxx-name.webp`. */
export function buildObjectKey(prefixDir: string, originalName: string): string {
  const safe = path.basename(originalName).replace(/[^a-zA-Z0-9._-]/g, '_');
  const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  const base = prefixDir.replace(/^\//, '').replace(/\/$/, '');
  return `${base}/${unique}-${safe}`;
}

export async function putS3Object(key: string, body: Buffer, contentType: string): Promise<void> {
  const c = getClient();
  const expiresDays = Number.isFinite(env.awsS3ObjectExpiresDays)
    ? env.awsS3ObjectExpiresDays
    : 3650;
  const expires = new Date(Date.now() + expiresDays * 24 * 60 * 60 * 1000);
  await c.send(
    new PutObjectCommand({
      Bucket: env.awsBucketName,
      Key: key,
      Body: body,
      ContentType: contentType || 'application/octet-stream',
      CacheControl: env.awsS3ObjectCacheControl,
      Expires: expires,
    }),
  );
}

export async function deleteS3Object(key: string): Promise<void> {
  if (!isS3Enabled()) return;
  const c = getClient();
  await c.send(
    new DeleteObjectCommand({
      Bucket: env.awsBucketName,
      Key: key,
    }),
  );
}

export function buildS3VirtualHostPublicUrl(objectKey: string): string {
  const segments = objectKey.split('/').map(encodeURIComponent);
  return `https://${env.awsBucketName}.s3.${env.awsRegion}.amazonaws.com/${segments.join('/')}`;
}

export async function getSignedGetUrl(key: string, expiresIn?: number): Promise<string> {
  const c = getClient();
  const cmd = new GetObjectCommand({
    Bucket: env.awsBucketName,
    Key: key,
  });
  return getSignedUrl(c, cmd, {
    expiresIn: expiresIn ?? env.awsS3SignedUrlExpiresSeconds,
  });
}

/** Permanent readable URL for browsers (`<img src>`). Bucket/objects must allow public read. */
export async function resolveS3KeyToUrl(key: string): Promise<string> {
  return buildS3VirtualHostPublicUrl(key);
}
