/**
 * R2Client — wrapper S3-compatible para Cloudflare R2.
 *
 * Implementação sobre `aws4fetch` (zero deps nativas, battle-tested).
 * Suporta apenas operações necessárias para o admin-center:
 *   - put / get / delete / list
 *   - signedUrl (download direto do bucket, sem proxy)
 *
 * Cifragem client-side (age) é responsabilidade do consumidor
 * (ver packages/r2-sdk/src/backup.ts).
 */
import { AwsClient } from 'aws4fetch';

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /** R2 não usa region real — sempre "auto". Default: "auto". */
  region?: string;
}

export interface R2Object {
  key: string;
  size: number;
  etag: string;
  uploaded: Date;
}

export interface R2ListResult {
  objects: R2Object[];
  /** Continuation token para próxima página (undefined = fim). */
  cursor?: string;
}

export interface R2PutResult {
  etag: string;
  size: number;
}

export class R2Error extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly operation: string,
    public readonly key?: string,
  ) {
    super(message);
    this.name = 'R2Error';
  }
}

export class R2Client {
  private readonly baseUrl: string;
  private readonly aws: AwsClient;
  private readonly bucket: string;

  constructor(config: R2Config) {
    if (!config.accountId) throw new Error('R2Config.accountId is required');
    if (!config.accessKeyId) throw new Error('R2Config.accessKeyId is required');
    if (!config.secretAccessKey) throw new Error('R2Config.secretAccessKey is required');
    if (!config.bucket) throw new Error('R2Config.bucket is required');

    this.bucket = config.bucket;
    this.baseUrl = `https://${config.accountId}.r2.cloudflarestorage.com`;
    this.aws = new AwsClient({
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      service: 's3',
      region: config.region ?? 'auto',
    });
  }

  /** Upload de blob (Buffer) para a chave. Retorna etag + size. */
  async put(
    key: string,
    body: Buffer | Uint8Array,
    options: { contentType?: string; metadata?: Record<string, string> } = {},
  ): Promise<R2PutResult> {
    const url = `${this.baseUrl}/${this.bucket}/${encodeURIComponent(key)}`;
    const headers: Record<string, string> = {};
    if (options.contentType) headers['content-type'] = options.contentType;
    if (options.metadata) {
      // S3 user-defined metadata é prefixado com x-amz-meta-
      for (const [k, v] of Object.entries(options.metadata)) {
        headers[`x-amz-meta-${k}`] = v;
      }
    }

    const res = await this.aws.fetch(url, {
      method: 'PUT',
      body: body as unknown as BodyInit,
      headers,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new R2Error(
        `R2 PUT failed: ${res.status} ${text.slice(0, 200)}`,
        res.status,
        'put',
        key,
      );
    }

    const etag = res.headers.get('etag')?.replace(/"/g, '') ?? '';
    // R2 não retorna Content-Length no PUT response — usar size do body
    const size = body.byteLength;
    return { etag, size };
  }

  /** Download de blob. Retorna Buffer + metadata. */
  async get(key: string): Promise<{
    body: Buffer;
    size: number;
    contentType?: string;
    metadata: Record<string, string>;
  }> {
    const url = `${this.baseUrl}/${this.bucket}/${encodeURIComponent(key)}`;
    const res = await this.aws.fetch(url, { method: 'GET' });

    if (res.status === 404) {
      throw new R2Error(`R2 object not found: ${key}`, 404, 'get', key);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new R2Error(
        `R2 GET failed: ${res.status} ${text.slice(0, 200)}`,
        res.status,
        'get',
        key,
      );
    }

    const arrayBuffer = await res.arrayBuffer();
    const body = Buffer.from(arrayBuffer);
    const metadata: Record<string, string> = {};
    for (const [k, v] of res.headers.entries()) {
      if (k.toLowerCase().startsWith('x-amz-meta-')) {
        metadata[k.slice(11).toLowerCase()] = v;
      }
    }

    return {
      body,
      size: body.byteLength,
      contentType: res.headers.get('content-type') ?? undefined,
      metadata,
    };
  }

  /** Delete por chave. Idempotente — 204 mesmo se chave não existe. */
  async delete(key: string): Promise<void> {
    const url = `${this.baseUrl}/${this.bucket}/${encodeURIComponent(key)}`;
    const res = await this.aws.fetch(url, { method: 'DELETE' });

    if (!res.ok && res.status !== 404) {
      const text = await res.text().catch(() => '');
      throw new R2Error(
        `R2 DELETE failed: ${res.status} ${text.slice(0, 200)}`,
        res.status,
        'delete',
        key,
      );
    }
  }

  /** Lista objetos (paginado). Use `cursor` para próxima página. */
  async list(
    prefix?: string,
    options: { limit?: number; cursor?: string } = {},
  ): Promise<R2ListResult> {
    const params = new URLSearchParams();
    if (prefix) params.set('prefix', prefix);
    if (options.limit) params.set('max-keys', String(options.limit));
    if (options.cursor) params.set('continuation-token', options.cursor);
    params.set('list-type', '2');

    const url = `${this.baseUrl}/${this.bucket}?${params.toString()}`;
    const res = await this.aws.fetch(url, { method: 'GET' });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new R2Error(`R2 LIST failed: ${res.status} ${text.slice(0, 200)}`, res.status, 'list');
    }

    const xml = await res.text();
    return parseListXml(xml);
  }

  /** Gera URL pré-assinada para download direto (sem proxy). */
  async signedUrl(key: string, expiresInSeconds: number): Promise<string> {
    if (expiresInSeconds <= 0 || expiresInSeconds > 604800) {
      throw new Error('expiresInSeconds must be between 1 and 604800 (7 days)');
    }

    const url = `${this.baseUrl}/${this.bucket}/${encodeURIComponent(key)}`;
    const presigner = new AwsClient({
      accessKeyId: this.aws.accessKeyId,
      secretAccessKey: this.aws.secretAccessKey,
      service: 's3',
      region: this.aws.region,
    });

    const signed = await presigner.sign(new URL(url), {
      method: 'GET',
      aws: { signQuery: true },
    });

    // signQuery retorna a URL modificada — extrair string
    return signed.url.toString();
  }

  /** Helper: testa credenciais fazendo um list vazio. */
  async ping(): Promise<void> {
    await this.list(undefined, { limit: 1 });
  }
}

/**
 * Parser XML mínimo da resposta ListObjectsV2.
 * S3/R2 retorna ~200 campos — só extraímos o essencial.
 *
 * Evitamos dependência de `fast-xml-parser` ou similar — a resposta
 * tem estrutura previsível e queremos zero deps nativas.
 */
function parseListXml(xml: string): R2ListResult {
  const objects: R2Object[] = [];
  const contentsRegex = /<Contents>([\s\S]*?)<\/Contents>/g;
  let match;

  while ((match = contentsRegex.exec(xml)) !== null) {
    const content = match[1] ?? '';
    const key = extractXmlField(content, 'Key');
    const etag = extractXmlField(content, 'ETag')?.replace(/"/g, '') ?? '';
    const size = Number(extractXmlField(content, 'Size') ?? '0');
    const lastModified = extractXmlField(content, 'LastModified') ?? '';
    if (key) {
      objects.push({
        key,
        size,
        etag,
        uploaded: new Date(lastModified),
      });
    }
  }

  const cursorMatch = /<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(xml);
  const isTruncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);

  return {
    objects,
    cursor: isTruncated ? cursorMatch?.[1] : undefined,
  };
}

function extractXmlField(content: string, field: string): string | undefined {
  const match = new RegExp(`<${field}>([^<]*)</${field}>`).exec(content);
  return match?.[1];
}
