import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Config, type ConfigOptions } from '../../src/lib/sikuwa/config';
import { ForbiddenException, RateLimitException } from '../../src/lib/sikuwa/exceptions';
import { AbstractProvider } from '../../src/lib/sikuwa/providers/abstract-provider';
import { EvolutionAPI } from '../../src/lib/sikuwa/providers/evolution-api/evolution-api';
import { Fonnte } from '../../src/lib/sikuwa/providers/fonnte/fonnte';
import { OpenWA } from '../../src/lib/sikuwa/providers/openwa/openwa';
import { Waxum } from '../../src/lib/sikuwa/providers/waxum/waxum';
import { MockBackend } from './mock-backend';

/**
 * Porting dari `tests/ProbeRetryTest.php`.
 *
 * Percobaan ulang pada `checkNumbers()`, bukan pada pengiriman pesan.
 *
 * Sebelum ini pemeriksaan nomor adalah satu-satunya jalur yang tidak menghormati
 * `Retry-After`: pengiriman pesan sudah mengulang sejak lama, sedangkan
 * pemeriksaan langsung melempar 429. Akibatnya paling terasa justru di gateway
 * yang memeriksa satu nomor per request — daftar sepuluh nomor berhenti di nomor
 * ketiga, dan pemanggil tidak pernah tahu nomor mana yang sudah dijawab.
 *
 * Yang paling penting diuji di sini bukan "apakah ia mengulang", melainkan
 * **di mana** ia mengulang. Percobaan ulang diletakkan per request, bukan
 * membungkus seluruh daftar: mengulang seluruh daftar berarti menanyakan ulang
 * nomor yang sudah dijawab, dan pada daftar panjang mengulang dari awal hampir
 * pasti menabrak batas laju yang sama lagi sehingga tidak pernah selesai.
 */

const BASE = 'https://gw.test';
const SESSION = 'sess-1';

let slept: number[] = [];

function rateLimited(retryAfter = 5): Response {
  return new Response('{"message":"rate limited"}', {
    status: 429,
    headers: { 'Content-Type': 'application/json', 'Retry-After': String(retryAfter) },
  });
}

function openWa(backend: MockBackend, options: ConfigOptions = {}): OpenWA {
  return new OpenWA({ token: 'k', url: BASE, session: SESSION, ...options }, backend.executor());
}

function waxum(backend: MockBackend, options: ConfigOptions = {}): Waxum {
  return new Waxum({ token: 'k', url: BASE, session: SESSION, ...options }, backend.executor());
}

beforeEach(() => {
  slept = [];
  AbstractProvider.useSleeper((seconds) => {
    slept.push(seconds);
  });
});

afterEach(() => {
  AbstractProvider.useSleeper(null);
  Config.useResolver(null);
});

// ---------------------------------------------------------------------------
// Bawaannya tetap mati
// ---------------------------------------------------------------------------

describe('probe retry — bawaannya mati', () => {
  test('percobaan ulang mati secara bawaan, 429 pertama langsung dilempar', async () => {
    const backend = new MockBackend([rateLimited(5)]);

    const error = await openWa(backend).checkNumbers('081234567890').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RateLimitException);

    // Bawaannya mati: jangan kirim request kedua.
    expect(backend.count()).toBe(1);
    expect(slept).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Yang mengulang
// ---------------------------------------------------------------------------

describe('probe retry — yang mengulang', () => {
  test('checkNumbers mengulang setelah batas laju', async () => {
    const backend = new MockBackend([
      rateLimited(7),
      MockBackend.json({ exists: true, whatsappId: '6281234567890@c.us' }),
    ]);

    const result = await openWa(backend, { retries: 1 }).checkNumbers('081234567890');

    // Satu percobaan awal + satu percobaan ulang.
    expect(backend.count()).toBe(2);

    // Tunggu sesuai Retry-After, bukan angka karangan.
    expect(slept).toEqual([7]);
    expect(result.isRegistered('081234567890')).toBe(true);
  });

  /**
   * Inti perubahan ini: percobaan ulang **per request**, bukan per daftar.
   *
   * Nomor pertama sudah dijawab sebelum nomor kedua ditolak, jadi mengulang
   * seluruh daftar akan menanyakannya lagi. Yang boleh terlihat di backend
   * hanyalah nomor kedua yang diminta ulang.
   */
  test('percobaan ulang per nomor tidak menanyakan ulang nomor yang sudah dijawab', async () => {
    const backend = new MockBackend([
      MockBackend.json({ exists: true }), // 6281234567890 — langsung dijawab
      rateLimited(2), // 6289876543210 — kena batas
      MockBackend.json({ exists: false }), // 6289876543210 — diulang, berhasil
    ]);

    const result = await openWa(backend, { retries: 1 }).checkNumbers([
      '081234567890',
      '089876543210',
    ]);

    expect(backend.count()).toBe(3);

    expect(backend.urlAt(0)).toContain('/contacts/check/6281234567890');
    expect(backend.urlAt(1)).toContain('/contacts/check/6289876543210');

    // Yang diulang hanya nomor yang ditolak, bukan nomor pertama.
    expect(backend.urlAt(2)).toContain('/contacts/check/6289876543210');

    expect(slept).toEqual([2]);
    expect(result.isRegistered('081234567890')).toBe(true);
    expect(result.isRegistered('089876543210')).toBe(false);
  });

  /** Gateway yang memeriksa seluruh daftar sekali panggil mengulang request itu. */
  test('gateway batch mengulang satu request-nya', async () => {
    const backend = new MockBackend([
      rateLimited(3),
      MockBackend.json({ results: [{ phone: '6281234567890', exists: true }] }),
    ]);

    const result = await waxum(backend, { retries: 1 }).checkNumbers('081234567890');

    expect(backend.count()).toBe(2);
    expect(slept).toEqual([3]);
    expect(result.isRegistered('081234567890')).toBe(true);
  });

  /**
   * Fonnte memotong daftar panjang menjadi beberapa request; tiap potongan
   * diulang sendiri — bukan potongan pertama yang diulang.
   */
  test('gateway berpotongan mengulang per potongan', async () => {
    const backend = new MockBackend([
      MockBackend.json({ status: true, registered: ['6281234567890'], not_registered: [] }),
      rateLimited(4),
      MockBackend.json({ status: true, registered: [], not_registered: ['6289876543210'] }),
    ]);

    const numbers = Array.from(
      { length: 501 },
      (_, i) => `0812${String(i + 1).padStart(7, '0')}`,
    );

    await new Fonnte({ token: 't', retries: 1 }, backend.executor()).checkNumbers(numbers);

    // Potongan pertama (500 nomor) langsung dijawab; potongan kedua (1 nomor)
    // ditolak lalu diulang — bukan mengulang potongan pertama.
    expect(backend.count()).toBe(3);
    expect(slept).toEqual([4]);

    // Fonnte mengirim form-encoded, jadi body-nya dibaca sebagai form — bukan
    // JSON, yang akan gagal diam-diam dan membuat pemeriksaan ini lolos tanpa
    // membuktikan apa pun.
    const target = backend.formAt(2)['target'] ?? '';

    expect(target).not.toBe('');
    expect(target).not.toContain(',');
    expect(target).toBe('628120000501');
  });

  /** Evolution API juga satu request untuk seluruh daftar — jalur yang sama. */
  test('Evolution API mengulang pemeriksaannya', async () => {
    const backend = new MockBackend([
      rateLimited(2),
      MockBackend.json([
        {
          jid: '6281234567890@s.whatsapp.net',
          exists: true,
          number: '6281234567890',
        },
      ]),
    ]);

    const result = await new EvolutionAPI(
      { token: 't', url: BASE, instance: 'sikuwa', retries: 1 },
      backend.executor(),
    ).checkNumbers('081234567890');

    expect(backend.count()).toBe(2);
    expect(slept).toEqual([2]);
    expect(result.isRegistered('081234567890')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Yang tetap tidak diulang
// ---------------------------------------------------------------------------

describe('probe retry — yang tetap tidak diulang', () => {
  test('status yang tidak bisa sembuh tidak diulang', async () => {
    // 403 tidak akan sembuh kalau diulang — kunci baca tetap kunci baca.
    const backend = new MockBackend([
      new Response('{"message":"butuh kunci operator"}', {
        status: 403,
        headers: { 'Retry-After': '10' },
      }),
    ]);

    const error = await openWa(backend, { retries: 5 })
      .checkNumbers('081234567890')
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ForbiddenException);
    expect(backend.count()).toBe(1);
    expect(slept).toEqual([]);
  });

  test('tanpa Retry-After tidak ada percobaan ulang', async () => {
    const backend = new MockBackend([
      new Response('{}', { status: 429, headers: { 'Content-Type': 'application/json' } }),
    ]);

    const error = await openWa(backend, { retries: 3 })
      .checkNumbers('081234567890')
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RateLimitException);

    // Tanpa Retry-After, menebak jeda hanya menabrak dinding yang sama.
    expect(backend.count()).toBe(1);
    expect(slept).toEqual([]);
  });

  test('percobaan ulang berhenti setelah jatahnya habis', async () => {
    const backend = new MockBackend([rateLimited(3), rateLimited(3), rateLimited(3)]);

    const error = await openWa(backend, { retries: 1 })
      .checkNumbers('081234567890')
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RateLimitException);
    expect(backend.count()).toBe(2);
    expect(slept).toEqual([3]);

    // Exception terakhir tetap membawa Retry-After.
    expect((error as RateLimitException).getRetryAfter()).toBe(3);
  });
});
