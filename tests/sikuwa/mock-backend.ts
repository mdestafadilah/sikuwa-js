import type { JsonObject } from '../../src/lib/sikuwa/support/envelope';
import { HttpExecutor, type FetchLike } from '../../src/lib/sikuwa/http/http-executor';

/**
 * Porting dari `tests/MockBackend.php`.
 *
 * Versi PHP menyusun klien Guzzle dengan `MockHandler` dan middleware
 * `history`; di sini peran itu dipegang satu fungsi biasa yang cocok dengan
 * `FetchLike`. Bedanya justru menguntungkan: tidak ada Guzzle, tidak ada
 * monkey-patching, dan yang diuji adalah kode yang benar-benar berjalan di
 * Node, Bun, dan Cloudflare Workers.
 *
 * Nama-nama methodnya sengaja dipertahankan (`lastForm`, `lastJson`,
 * `lastHeader`) supaya test yang diporting dari PHP tetap terbaca sama.
 */

/** Satu request yang sudah lewat, dalam bentuk yang mudah diperiksa. */
export interface RecordedRequest {
  url: string;
  method: string;
  headers: Headers;
  /** Body sebagai teks; kosong untuk multipart dan untuk request tanpa body. */
  text: string;
  /** Body form-encoded yang sudah diurai. */
  form: Record<string, string>;
  /** Bagian multipart, dalam urutan pengirimannya. */
  multipart: Array<[string, FormDataEntryValue]>;
}

/** Respons yang dibalas berurutan, atau Error yang dilempar sebagai kegagalan transport. */
export type QueuedResponse = Response | Error;

/**
 * Gateway palsu untuk pengujian: membalas dari antrean respons dan merekam
 * setiap request yang masuk.
 *
 * Dipasang lewat argumen kedua konstruktor provider, jadi tidak ada jaringan
 * yang tersentuh dan tidak ada perilaku global yang berubah.
 */
export class MockBackend {
  readonly requests: RecordedRequest[] = [];

  private readonly queue: QueuedResponse[];

  constructor(responses: QueuedResponse[] = []) {
    this.queue = [...responses];
  }

  client(): FetchLike {
    return async (url, init) => {
      const request = init ?? {};
      const body = captureBody(request.body);

      this.requests.push({
        url,
        method: request.method ?? 'GET',
        headers: new Headers(request.headers),
        text: body.text,
        form: body.form,
        multipart: body.multipart,
      });

      const next = this.queue.shift();

      if (next === undefined) {
        // Sengaja dilempar, bukan dibalas 500: antrean yang kurang adalah
        // kesalahan test, dan pesannya harus muncul apa adanya di kegagalan.
        throw new Error('MockBackend: antrean respons habis');
      }

      if (next instanceof Error) throw next;

      return next;
    };
  }

  /** Executor yang menembak ke backend ini. */
  executor(timeout = 10, defaultHeaders: Record<string, string> = {}): HttpExecutor {
    return new HttpExecutor(this.client(), timeout, defaultHeaders);
  }

  static json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /** Respons 2xx yang body-nya bukan JSON. */
  static raw(body = '<html>oops</html>', status = 200): Response {
    return new Response(body, { status, headers: { 'Content-Type': 'text/html' } });
  }

  /**
   * Kegagalan timeout seperti yang dilempar `AbortSignal.timeout()`.
   *
   * Versi PHP memakai `ConnectException` Guzzle dengan pesan `cURL error 28`.
   * Di sini transportnya `fetch`, jadi bentuknya pun berbeda — yang dijaga
   * adalah *jenis* kegagalannya, bukan teks pesannya.
   */
  static timeout(): Error {
    const error = new Error('The operation was aborted due to timeout');
    error.name = 'TimeoutError';
    return error;
  }

  /** Kegagalan transport yang bukan timeout — mis. DNS tidak menemukan host. */
  static connectionFailure(): Error {
    return new Error('fetch failed: getaddrinfo ENOTFOUND');
  }

  count(): number {
    return this.requests.length;
  }

  requestAt(index: number): RecordedRequest {
    const request = this.requests[index];

    if (request === undefined) {
      throw new Error(`MockBackend: request ke-${index} tidak ada (tercatat ${this.count()})`);
    }

    return request;
  }

  lastRequest(): RecordedRequest | null {
    return this.requests.at(-1) ?? null;
  }

  urlAt(index: number): string {
    return this.requestAt(index).url;
  }

  methodAt(index: number): string {
    return this.requestAt(index).method;
  }

  lastUrl(): string {
    return this.lastRequest()?.url ?? '';
  }

  lastBody(): string {
    return this.lastRequest()?.text ?? '';
  }

  lastJson(): JsonObject {
    return asObject(this.jsonAt(this.count() - 1));
  }

  jsonAt(index: number): unknown {
    return JSON.parse(this.requestAt(index).text) as unknown;
  }

  /** Body form-encoded dari request terakhir, sudah di-decode. */
  lastForm(): Record<string, string> {
    return this.lastRequest()?.form ?? {};
  }

  formAt(index: number): Record<string, string> {
    return this.requestAt(index).form;
  }

  lastMultipart(): Array<[string, FormDataEntryValue]> {
    return this.lastRequest()?.multipart ?? [];
  }

  lastHeader(name: string): string {
    return this.lastRequest()?.headers.get(name) ?? '';
  }

  headerAt(index: number, name: string): string {
    return this.requestAt(index).headers.get(name) ?? '';
  }
}

/** Body request apa adanya, diurai menurut bentuknya. */
function captureBody(body: RequestInit['body']): Pick<
  RecordedRequest,
  'text' | 'form' | 'multipart'
> {
  if (body === null || body === undefined) {
    return { text: '', form: {}, multipart: [] };
  }

  if (typeof body === 'string') {
    return { text: body, form: {}, multipart: [] };
  }

  if (body instanceof FormData) {
    // Multipart sengaja tidak diratakan menjadi teks: yang diperiksa test
    // adalah nama bagian dan isinya, bukan susunan byte-nya.
    return { text: '', form: {}, multipart: [...body.entries()] };
  }

  if (body instanceof URLSearchParams) {
    return {
      text: body.toString(),
      form: Object.fromEntries(body.entries()),
      multipart: [],
    };
  }

  return { text: String(body), form: {}, multipart: [] };
}

function asObject(value: unknown): JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}
