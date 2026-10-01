import { describe, expect, test } from 'bun:test';
import { HttpResponse } from '../../src/lib/sikuwa/http/http-response';
import { HttpExecutor, type FetchLike } from '../../src/lib/sikuwa/http/http-executor';

/**
 * Tes untuk lapisan transport.
 *
 * Versi PHP tidak punya berkas tes tersendiri untuk `HttpExecutor` — ia diuji
 * lewat provider dengan `MockHandler` Guzzle. Di sini klien HTTP disuntikkan
 * sebagai fungsi biasa, sehingga aturan yang berlaku untuk semua method
 * (tanpa redirect, tanpa throw, header yang tidak bisa ditimpa) bisa
 * dibuktikan langsung.
 */

interface Call {
  url: string;
  init: RequestInit;
}

/** Executor dengan klien HTTP palsu yang mencatat setiap panggilan. */
function makeExecutor(
  respond: () => Response,
  timeout = 10,
  defaultHeaders: Record<string, string> = {},
): { executor: HttpExecutor; calls: Call[] } {
  const calls: Call[] = [];

  const fetchLike: FetchLike = async (url, init) => {
    calls.push({ url, init: init ?? {} });
    return respond();
  };

  return { executor: new HttpExecutor(fetchLike, timeout, defaultHeaders), calls };
}

const headerOf = (call: Call, name: string): string | null =>
  new Headers(call.init.headers).get(name);

describe('HttpResponse', () => {
  test('isSuccess hanya untuk 2xx tanpa kegagalan transport', () => {
    expect(new HttpResponse(200, '{}').isSuccess()).toBe(true);
    expect(new HttpResponse(299, '{}').isSuccess()).toBe(true);
    expect(new HttpResponse(301, '').isSuccess()).toBe(false);
    expect(new HttpResponse(500, '{}').isSuccess()).toBe(false);
    // Respons HTTP 4xx/5xx tetap dianggap "sampai"; kegagalan transport tidak.
    expect(new HttpResponse(0, null, 'getaddrinfo ENOTFOUND').isSuccess()).toBe(false);
  });

  test('json mengurai objek dan daftar, mengabaikan sisanya', () => {
    expect(new HttpResponse(200, '{"ok":true}').json()).toEqual({ ok: true });
    expect(new HttpResponse(200, '[1,2]').json()).toEqual([1, 2]);
    expect(new HttpResponse(200, 'bukan json').json()).toBeNull();
    expect(new HttpResponse(200, '123').json()).toBeNull();
    expect(new HttpResponse(200, '').json()).toBeNull();
    expect(new HttpResponse(204, null).json()).toBeNull();
  });

  test('retryAfterSeconds membaca bentuk detik', () => {
    expect(new HttpResponse(429, '', '', false, '30').retryAfterSeconds()).toBe(30);
    expect(new HttpResponse(429, '', '', false, ' 30 ').retryAfterSeconds()).toBe(30);
  });

  test('retryAfterSeconds mengabaikan nilai yang tidak berguna', () => {
    expect(new HttpResponse(429, '', '', false, null).retryAfterSeconds()).toBeNull();
    expect(new HttpResponse(429, '', '', false, '').retryAfterSeconds()).toBeNull();
    expect(new HttpResponse(429, '', '', false, 'abc').retryAfterSeconds()).toBeNull();
    // Menunggu nol detik sama saja dengan tidak menunggu.
    expect(new HttpResponse(429, '', '', false, '0').retryAfterSeconds()).toBeNull();
    expect(new HttpResponse(429, '', '', false, '-5').retryAfterSeconds()).toBeNull();
  });

  test('retryAfterSeconds mengubah tanggal HTTP menjadi selisih detik', () => {
    const future = new Date(Date.now() + 60_000).toUTCString();
    const seconds = new HttpResponse(503, '', '', false, future).retryAfterSeconds();

    expect(seconds).not.toBeNull();
    expect(seconds as number).toBeGreaterThanOrEqual(55);
    expect(seconds as number).toBeLessThanOrEqual(61);
  });

  test('retryAfterSeconds mengembalikan null untuk tanggal yang sudah lewat', () => {
    const past = new Date(Date.now() - 60_000).toUTCString();

    expect(new HttpResponse(503, '', '', false, past).retryAfterSeconds()).toBeNull();
  });
});

describe('HttpExecutor', () => {
  test('post mengirim body sebagai form-encoded', async () => {
    const { executor, calls } = makeExecutor(() => new Response('{"ok":true}'));

    const response = await executor.post('https://gw.test/send', {
      target: '0811',
      message: 'halo dunia',
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://gw.test/send');
    expect(calls[0]?.init.method).toBe('POST');
    expect(String(calls[0]?.init.body)).toBe('target=0811&message=halo+dunia');
    expect(headerOf(calls[0] as Call, 'content-type')).toContain(
      'application/x-www-form-urlencoded',
    );
    expect(response.isSuccess()).toBe(true);
    expect(response.json()).toEqual({ ok: true });
  });

  test('post mengirim body mentah apa adanya', async () => {
    const { executor, calls } = makeExecutor(() => new Response('{"status":true}'));

    await executor.post('https://gw.test/send', '{"target":"0811"}', {
      'Content-Type': 'application/json',
    });

    expect(calls[0]?.init.body).toBe('{"target":"0811"}');
    expect(headerOf(calls[0] as Call, 'content-type')).toBe('application/json');
  });

  test('get tidak membawa body', async () => {
    const { executor, calls } = makeExecutor(() => new Response('{}'));

    await executor.get('https://gw.test/api/sessions/sess-1', { 'X-API-Key': 'k' });

    expect(calls[0]?.init.method).toBe('GET');
    expect(calls[0]?.init.body).toBeUndefined();
    expect(headerOf(calls[0] as Call, 'x-api-key')).toBe('k');
  });

  test('postMultipart mengirim FormData', async () => {
    const { executor, calls } = makeExecutor(() => new Response('{"status":true}'));

    await executor.postMultipart(
      'https://api.fonnte.com/send',
      [
        { name: 'target', contents: '0811' },
        { name: 'file', contents: new Uint8Array([104, 97, 108, 111]), filename: 'bukti.txt' },
      ],
      { Authorization: 'tok' },
    );

    const body = calls[0]?.init.body;

    expect(body).toBeInstanceOf(FormData);
    expect((body as FormData).get('target')).toBe('0811');
    expect(headerOf(calls[0] as Call, 'authorization')).toBe('tok');
    // `Content-Type` sengaja tidak diisi: hanya runtime yang tahu boundary-nya.
    expect(headerOf(calls[0] as Call, 'content-type')).toBeNull();
  });

  test('redirect tidak pernah diikuti', async () => {
    const { executor, calls } = makeExecutor(() => new Response('{}'));

    await executor.get('https://gw.test/api/sessions');

    expect(calls[0]?.init.redirect).toBe('manual');
  });

  test('status non-2xx tidak dilempar, hanya dilaporkan', async () => {
    const { executor } = makeExecutor(
      () => new Response('{"error":"token salah"}', { status: 401 }),
    );

    const response = await executor.get('https://gw.test/api/sessions');

    expect(response.status).toBe(401);
    expect(response.error).toBe('');
    expect(response.isSuccess()).toBe(false);
    expect(response.json()).toEqual({ error: 'token salah' });
  });

  test('header Retry-After ikut terbaca dari respons', async () => {
    const { executor } = makeExecutor(
      () => new Response('{}', { status: 429, headers: { 'Retry-After': '30' } }),
    );

    const response = await executor.get('https://gw.test/send');

    expect(response.status).toBe(429);
    expect(response.retryAfter).toBe('30');
    expect(response.retryAfterSeconds()).toBe(30);
  });

  test('header provider menang atas header bawaan pemanggil', async () => {
    const { executor, calls } = makeExecutor(
      () => new Response('{}'),
      10,
      { Authorization: 'bawaan', 'X-Trace': 'abc' },
    );

    await executor.get('https://gw.test/send', { Authorization: 'provider' });

    expect(headerOf(calls[0] as Call, 'authorization')).toBe('provider');
    expect(headerOf(calls[0] as Call, 'x-trace')).toBe('abc');
  });

  test('kegagalan transport dilaporkan lewat error, bukan dilempar', async () => {
    const executor = new HttpExecutor(async () => {
      throw new Error('getaddrinfo ENOTFOUND gw.test');
    });

    const response = await executor.get('https://gw.test/send');

    expect(response.status).toBe(0);
    expect(response.body).toBeNull();
    expect(response.error).toBe('getaddrinfo ENOTFOUND gw.test');
    expect(response.timedOut).toBe(false);
  });

  test('timeout ditandai, bukan disamakan dengan kegagalan lain', async () => {
    const executor = new HttpExecutor(async () => {
      const error = new Error('The operation was aborted due to timeout');
      error.name = 'TimeoutError';
      throw error;
    });

    const response = await executor.get('https://gw.test/send');

    expect(response.status).toBe(0);
    expect(response.timedOut).toBe(true);
    expect(response.isSuccess()).toBe(false);
  });

  test('timeout dan header bawaan bisa dibaca kembali', () => {
    const { executor } = makeExecutor(() => new Response('{}'), 25, { 'X-Trace': 'abc' });

    expect(executor.timeout()).toBe(25);
    expect(typeof executor.client()).toBe('function');
  });
});
