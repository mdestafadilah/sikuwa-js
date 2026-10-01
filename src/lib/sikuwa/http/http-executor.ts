import { HttpResponse } from './http-response';

/**
 * Bentuk klien HTTP yang bisa disuntik.
 *
 * Sengaja cocok dengan `fetch` bawaan Node, Bun, Cloudflare Workers, dan
 * peramban, sehingga pengujian bisa menyuntikkan fungsi biasa tanpa
 * monkey-patching global — peran yang di versi PHP dipegang
 * `MockHandler` milik Guzzle.
 */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Satu bagian body `multipart/form-data`. */
export interface MultipartPart {
  name: string;
  contents: string | Uint8Array | Blob;
  filename?: string;
  headers?: Record<string, string>;
}

/**
 * Transport HTTP yang bisa disuntik.
 *
 * SDK tidak pernah membangun klien HTTP dengan handler yang dipaku di dalam.
 * Untuk pengujian, suntikkan klien pengganti lewat opsi `httpClient` pada
 * `Client` — tanpa monkey-patching global.
 *
 * Method `post()` dan `get()` tidak pernah melempar exception; kegagalan
 * transport dilaporkan lewat `HttpResponse.error`. Yang melempar adalah
 * provider, supaya pesan errornya bisa disesuaikan dengan amplop gateway
 * masing-masing.
 */
export class HttpExecutor {
  /** Batas waktu handshake koneksi (detik). */
  static readonly CONNECT_TIMEOUT = 5.0;

  private readonly http: FetchLike;
  private readonly timeoutSeconds: number;
  private readonly defaultHeaders: Record<string, string>;

  /**
   * @param httpClient     Klien pengganti; bawaan `fetch` global.
   * @param timeout        Batas waktu request, detik.
   * @param defaultHeaders Dikirim pada setiap request, di bawah header milik
   *                       provider (yang selalu menang).
   */
  constructor(
    httpClient?: FetchLike | null,
    timeout = 10.0,
    defaultHeaders: Record<string, string> = {},
  ) {
    this.http = httpClient ?? ((input, init) => fetch(input, init));
    this.timeoutSeconds = timeout;
    this.defaultHeaders = defaultHeaders;
  }

  timeout(): number {
    return this.timeoutSeconds;
  }

  client(): FetchLike {
    return this.http;
  }

  /**
   * Kirim satu request POST.
   *
   * @param body    objek => form-encoded, string => body mentah
   * @param headers Header untuk request ini, dalam bentuk peta
   *                `{ Nama: 'nilai' }` — bukan daftar `['Nama: nilai']`.
   */
  async post(
    url: string,
    body: Record<string, unknown> | string,
    headers: Record<string, string> = {},
  ): Promise<HttpResponse> {
    if (typeof body === 'string') {
      return this.send('POST', url, { body }, headers);
    }

    // Jenis isi diisi sendiri, tidak diserahkan ke runtime: `form_params` di
    // Guzzle juga begitu, dan dengan begitu header ini ikut terlihat pada klien
    // HTTP yang disuntikkan saat pengujian. Header pemanggil tetap menang.
    return this.send('POST', url, { body: encodeForm(body) }, {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...headers,
    });
  }

  /**
   * Kirim satu request POST berbadan `multipart/form-data`.
   *
   * Dibutuhkan gateway yang menuntut berkasnya diunggah sebagai biner —
   * Fonnte dan ApiMe — bukan dikirim sebagai base64 di dalam JSON. Bentuk
   * form-encoded tidak bisa dipakai untuk itu: ia meng-encode semuanya sebagai
   * teks, sehingga byte berkasnya rusak.
   *
   * `Content-Type` sengaja tidak diisi: hanya runtime yang tahu `boundary`
   * yang dipakai memisahkan bagian-bagian body, dan header buatan sendiri akan
   * membuat server gagal mengurainya.
   */
  async postMultipart(
    url: string,
    parts: MultipartPart[],
    headers: Record<string, string> = {},
  ): Promise<HttpResponse> {
    const form = new FormData();

    for (const part of parts) {
      if (typeof part.contents === 'string') {
        if (part.filename === undefined) {
          form.append(part.name, part.contents);
        } else {
          form.append(
            part.name,
            new Blob([part.contents], { type: part.headers?.['Content-Type'] }),
            part.filename,
          );
        }
        continue;
      }

      if (part.contents instanceof Blob) {
        form.append(part.name, part.contents, part.filename ?? part.name);
        continue;
      }

      // `Uint8Array` diterima `Blob` sebagai ArrayBufferView; tipe yang
      // dipakai di sini hanya supaya berkas ini juga lolos di konfigurasi
      // TypeScript yang tidak memuat tipe DOM.
      const blob = new Blob([part.contents as unknown as ArrayBuffer], {
        type: part.headers?.['Content-Type'],
      });

      form.append(part.name, blob, part.filename ?? part.name);
    }

    return this.send('POST', url, { body: form }, headers);
  }

  /**
   * Kirim satu request GET tanpa body.
   *
   * Dipakai endpoint yang hanya membaca keadaan — mis. pemeriksaan sesi —
   * sehingga provider tidak perlu merakit request-nya sendiri.
   */
  async get(url: string, headers: Record<string, string> = {}): Promise<HttpResponse> {
    return this.send('GET', url, {}, headers);
  }

  /**
   * Satu-satunya tempat request benar-benar ditembak, supaya aturan yang
   * berlaku untuk semua method (tanpa redirect, tanpa throw, timeout) hanya
   * ditulis sekali.
   */
  private async send(
    method: string,
    url: string,
    init: RequestInit,
    headers: Record<string, string>,
  ): Promise<HttpResponse> {
    // Header provider ditaruh paling akhir supaya tidak bisa ditimpa oleh
    // defaultHeaders milik pemanggil.
    const merged = new Headers(this.defaultHeaders);

    for (const [name, value] of Object.entries(headers)) {
      merged.set(name, value);
    }

    // Redirect tidak pernah diikuti: token dikirim ulang ke host tujuan, yang
    // belum tentu origin yang sama.
    const request: RequestInit = {
      ...init,
      method,
      headers: merged,
      redirect: 'manual',
      signal: AbortSignal.timeout(Math.max(1, Math.round(this.timeoutSeconds * 1000))),
    };

    let response: Response;

    try {
      response = await this.http(url, request);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const name = error instanceof Error ? error.name : '';

      // AbortSignal.timeout melempar TimeoutError; AbortController manual
      // melempar AbortError. Keduanya sama artinya di sini.
      const timedOut = name === 'TimeoutError' || name === 'AbortError' || /timed out/i.test(message);

      return new HttpResponse(0, null, message, timedOut);
    }

    let bytes: Uint8Array;
    let text: string;

    try {
      // Body dibaca sebagai byte mentah lebih dulu, lalu diterjemahkan sendiri
      // — bukan lewat `response.text()`.
      //
      // Alasannya bukan efisiensi (`text()` juga menampung seluruh body di
      // memori sebelum mendecode), melainkan karena `HttpResponse.bytes` hanya
      // berguna kalau isinya byte yang benar-benar dikirim server. Body respons
      // cuma bisa dikonsumsi sekali, jadi tidak ada cara membaca teks dan byte
      // secara terpisah: salah satunya harus diturunkan dari yang lain, dan
      // arah yang benar adalah byte → teks. Sebaliknya, byte yang sudah
      // melewati decoder UTF-8 tidak bisa dipulihkan.
      bytes = new Uint8Array(await response.arrayBuffer());
      text = UTF8.decode(bytes);
    } catch (error) {
      return new HttpResponse(
        response.status,
        null,
        error instanceof Error ? error.message : String(error),
      );
    }

    return new HttpResponse(
      response.status,
      text,
      '',
      false,
      // Diambil di sini karena inilah satu-satunya titik yang masih memegang
      // objek respons; setelah ini provider hanya melihat HttpResponse.
      response.headers.get('Retry-After'),
      // Body kosong dilaporkan sebagai null, bukan byte sepanjang nol: tidak
      // ada yang bisa dibaca darinya, dan `body === ''` sudah mengatakan hal
      // yang sama.
      bytes.length === 0 ? null : bytes,
    );
  }
}

/**
 * Decoder UTF-8 bersama untuk seluruh request.
 *
 * Boleh dipakai ulang: `TextDecoder` hanya menyimpan keadaan antar-panggilan
 * bila diminta `{stream: true}`, dan di sini tidak pernah. Perilakunya sama
 * persis dengan `response.text()` bawaan runtime — byte di luar UTF-8 menjadi
 * U+FFFD, dan BOM di awal body dibuang — jadi body JSON dari ketujuh gateway
 * tidak berubah sedikit pun.
 */
const UTF8 = new TextDecoder();

/**
 * `http_build_query()` PHP: form-encoded, spasi menjadi `+`.
 *
 * Dikembalikan sebagai `URLSearchParams` supaya runtime ikut mengirim header
 * `Content-Type: application/x-www-form-urlencoded` — persis seperti yang
 * dilakukan Guzzle pada opsi `form_params`.
 */
function encodeForm(body: Record<string, unknown>): URLSearchParams {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(body)) {
    if (value === null || value === undefined) continue;

    params.append(key, typeof value === 'string' ? value : String(value));
  }

  return params;
}
