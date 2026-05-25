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

/** Resolve a stored DB value (either `s3:object/key` or a configured S3 HTTPS URL) to a signed GET URL. */
export async function resolveStoredToSignedUrl(
  raw: string | null | undefined,
  expiresIn?: number,
): Promise<string | null> {
  if (raw == null || raw === '') return null;
  const m = raw.match(/^s3:(.+)$/);
  if (!isS3Enabled()) return raw;
  try {
    if (m) return await getSignedGetUrl(m[1]!, expiresIn);

    // Try to parse known S3 URL formats and extract the object key. Support:
    // - https://{bucket}.s3.{region}.amazonaws.com/{key}
    // - https://{bucket}.s3.amazonaws.com/{key}
    // - https://s3.{region}.amazonaws.com/{bucket}/{key}
    // - https://s3.amazonaws.com/{bucket}/{key}
    // Fallback: attempt to remove leading /{bucket}/ from pathname.
    const url = new URL(raw);
    if (url.protocol !== 'https:') return raw;

    const host = url.hostname;
    const path = decodeURIComponent(url.pathname || '');

    // 1) virtual-hosted style: {bucket}.s3.{region}.amazonaws.com or {bucket}.s3.amazonaws.com
    const virtualHostMatch = host.match(
      /^(?<bucket>[^.]+)\.s3(?:\.(?<region>[^.]+))?\.amazonaws\.com$/,
    );
    if (virtualHostMatch && virtualHostMatch.groups) {
      const key = path.replace(/^\/+/, '');
      if (key) return await getSignedGetUrl(key, expiresIn);
    }

    // 2) path-style: s3.{region}.amazonaws.com/{bucket}/{key} or s3.amazonaws.com/{bucket}/{key}
    const pathStyleMatch = host.match(/^s3(?:\.(?<region>[^.]+))?\.amazonaws\.com$/);
    if (pathStyleMatch) {
      const parts = path.replace(/^\/+/, '').split('/');
      if (parts.length >= 2) {
        const bucket = parts.shift();
        if (bucket === env.awsBucketName) {
          const key = parts.join('/');
          if (key) return await getSignedGetUrl(key, expiresIn);
        }
      }
    }

    // 3) Sometimes stored URLs include the bucket as the first segment even on other hosts
    const fallbackParts = path.replace(/^\/+/, '').split('/');
    if (fallbackParts.length >= 2 && fallbackParts[0] === env.awsBucketName) {
      const key = fallbackParts.slice(1).join('/');
      if (key) return await getSignedGetUrl(key, expiresIn);
    }

    return raw;
  } catch {
    return raw;
  }
}

/** Permanent readable URL for browsers (`<img src>`). Bucket/objects must allow public read. */
export async function resolveS3KeyToUrl(key: string): Promise<string> {
  // return buildS3VirtualHostPublicUrl(key);
  if (env.awsS3UsePublicUrl) {
    return buildS3VirtualHostPublicUrl(key);
  }
  return getSignedGetUrl(key);
}
