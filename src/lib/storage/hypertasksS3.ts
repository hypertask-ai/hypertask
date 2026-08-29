import { S3Client } from "@aws-sdk/client-s3";
import S3 from "aws-sdk/clients/s3";

const DEFAULT_S3_REGION = "us-east-2";
const DEFAULT_S3_BUCKET = "hypertasks";

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function firstConfiguredBaseUrl(
  values: Array<string | undefined>
): string | undefined {
  const value = values.find((candidate) => Boolean(candidate));
  return value ? trimTrailingSlash(value) : undefined;
}

function isR2Configured(): boolean {
  return Boolean(
    process.env.R2_ENDPOINT &&
      process.env.R2_UPLOAD_KEY &&
      process.env.R2_UPLOAD_SECRET &&
      process.env.R2_UPLOAD_BUCKET &&
      process.env.R2_PUBLIC_BASE_URL
  );
}

export const HYPERTASKS_STORAGE_IS_R2 = isR2Configured();
export const HYPERTASKS_S3_REGION = HYPERTASKS_STORAGE_IS_R2
  ? "auto"
  : DEFAULT_S3_REGION;
export const HYPERTASKS_S3_BUCKET = HYPERTASKS_STORAGE_IS_R2
  ? process.env.R2_UPLOAD_BUCKET!
  : DEFAULT_S3_BUCKET;

const DEFAULT_S3_PUBLIC_BASE_URL = `https://${DEFAULT_S3_BUCKET}.s3.${DEFAULT_S3_REGION}.amazonaws.com`;

export const HYPERTASKS_STORAGE_PUBLIC_BASE_URL =
  HYPERTASKS_STORAGE_IS_R2
    ? trimTrailingSlash(process.env.R2_PUBLIC_BASE_URL!)
    : firstConfiguredBaseUrl([
        process.env.S3_PUBLIC_BASE_URL,
        process.env.S3_CLOUDFRONT_BUCKET_BASE_URL,
        process.env.NEXT_PUBLIC_S3_CLOUDFRONT_BUCKET_BASE_URL,
        process.env.S3_BUCKET_BASE_URL,
        process.env.NEXT_PUBLIC_S3_BUCKET_BASE_URL,
        DEFAULT_S3_PUBLIC_BASE_URL,
      ])!;

let client: S3 | null = null;

/**
 * S3-compatible client for Hypertasks uploads. Set
 * R2_ENDPOINT/R2_UPLOAD_KEY/R2_UPLOAD_SECRET/R2_UPLOAD_BUCKET/R2_PUBLIC_BASE_URL
 * to activate R2; existing S3 files must be copied over and stored URLs rewritten
 * as a separate migration.
 *
 * On Vercel the AWS default credential chain has nothing to find (no instance
 * role, and AWS_ACCESS_KEY_ID is a reserved env name there), so explicit S3 keys
 * are passed via S3_UPLOAD_KEY/S3_UPLOAD_SECRET when present. Without them it
 * falls back to the default chain (EC2 instance IAM role, ~/.aws/credentials
 * locally).
 */
export function getHypertasksS3Client(): S3 {
  if (!client) {
    if (HYPERTASKS_STORAGE_IS_R2) {
      const config: S3.ClientConfiguration & { forcePathStyle: boolean } = {
        endpoint: process.env.R2_ENDPOINT!,
        region: HYPERTASKS_S3_REGION,
        credentials: {
          accessKeyId: process.env.R2_UPLOAD_KEY!,
          secretAccessKey: process.env.R2_UPLOAD_SECRET!,
        },
        forcePathStyle: true,
        s3ForcePathStyle: true,
        signatureVersion: "v4",
      };
      client = new S3(config);
    } else {
      const { S3_UPLOAD_KEY, S3_UPLOAD_SECRET } = process.env;
      client = new S3({
        region: HYPERTASKS_S3_REGION,
        ...(S3_UPLOAD_KEY && S3_UPLOAD_SECRET
          ? {
              credentials: {
                accessKeyId: S3_UPLOAD_KEY,
                secretAccessKey: S3_UPLOAD_SECRET,
              },
            }
          : {}),
      });
    }
  }
  return client;
}

let presignClient: S3Client | null = null;

/**
 * SDK v3 client, used only to pre-sign uploads. The v2 presigner refuses
 * ContentLength outright, while v3 can put content-length into the signature,
 * which is what makes storage itself reject a body larger than the one the
 * ticket was issued for (HTPR-5524 review).
 */
export function getHypertasksPresignClient(): S3Client {
  if (!presignClient) {
    presignClient = HYPERTASKS_STORAGE_IS_R2
      ? new S3Client({
          endpoint: process.env.R2_ENDPOINT!,
          region: HYPERTASKS_S3_REGION,
          credentials: {
            accessKeyId: process.env.R2_UPLOAD_KEY!,
            secretAccessKey: process.env.R2_UPLOAD_SECRET!,
          },
          forcePathStyle: true,
        })
      : new S3Client({
          region: HYPERTASKS_S3_REGION,
          ...(process.env.S3_UPLOAD_KEY && process.env.S3_UPLOAD_SECRET
            ? {
                credentials: {
                  accessKeyId: process.env.S3_UPLOAD_KEY,
                  secretAccessKey: process.env.S3_UPLOAD_SECRET,
                },
              }
            : {}),
        });
  }
  return presignClient;
}

export function getHypertasksStoragePublicUrl(key: string): string {
  return `${HYPERTASKS_STORAGE_PUBLIC_BASE_URL}/${key.replace(/^\/+/, "")}`;
}

function getKeyFromBaseUrl(fileSource: URL, baseUrl: string): string | null {
  const base = new URL(baseUrl);
  if (fileSource.protocol !== base.protocol || fileSource.host !== base.host) {
    return null;
  }

  const basePath = base.pathname.replace(/\/+$/, "");
  const sourcePath = fileSource.pathname;
  if (basePath && basePath !== "/" && !sourcePath.startsWith(`${basePath}/`)) {
    return null;
  }

  return sourcePath.slice(basePath.length).replace(/^\/+/, "") || null;
}

export function parseHypertasksStorageKeyFromUrl(
  fileSource: string
): string | null {
  try {
    const url = new URL(fileSource);
    const configuredBases = [
      HYPERTASKS_STORAGE_PUBLIC_BASE_URL,
      process.env.R2_PUBLIC_BASE_URL,
      process.env.S3_PUBLIC_BASE_URL,
      process.env.S3_CLOUDFRONT_BUCKET_BASE_URL,
      process.env.NEXT_PUBLIC_S3_CLOUDFRONT_BUCKET_BASE_URL,
      process.env.S3_BUCKET_BASE_URL,
      process.env.NEXT_PUBLIC_S3_BUCKET_BASE_URL,
      DEFAULT_S3_PUBLIC_BASE_URL,
    ].filter((base): base is string => Boolean(base));

    for (const base of configuredBases) {
      try {
        const key = getKeyFromBaseUrl(url, trimTrailingSlash(base));
        if (key) {
          return key;
        }
      } catch {
        continue;
      }
    }

    if (
      url.hostname.endsWith("amazonaws.com") ||
      url.hostname.endsWith("cloudfront.net")
    ) {
      return url.pathname.replace(/^\/+/, "") || null;
    }

    return null;
  } catch {
    return null;
  }
}
