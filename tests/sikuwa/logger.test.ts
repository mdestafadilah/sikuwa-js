import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Client } from '../../src/lib/sikuwa/client';
import { Config, type ConfigOptions } from '../../src/lib/sikuwa/config';
import type { OutgoingMessage } from '../../src/lib/sikuwa/contracts/whatsapp';
import { AbstractProvider } from '../../src/lib/sikuwa/providers/abstract-provider';
import { ApiMe } from '../../src/lib/sikuwa/providers/apime/apime';
import { OpenWA } from '../../src/lib/sikuwa/providers/openwa/openwa';
import { type LoggerLike } from '../../src/lib/sikuwa/support/log';
import { MockBackend } from './mock-backend';

/**
 * Porting dari `tests/LoggerTest.php`.
 *
 * Yang dicatat hanya kejadian yang tadinya senyap sama sekali: indikator
 * "sedang mengetik" yang gagal ditampilkan, dan percobaan ulang setelah
 * gateway menolak sementara. Keduanya sengaja tidak menggagalkan pengiriman,
 * jadi yang perlu dibuktikan di sini ada dua hal sekaligus — bahwa logger
 * benar-benar menerima catatannya, dan bahwa tanpa logger tidak ada satu pun
 * perilaku yang berubah.
 *
 * Versi PHP memakai PSR-3 `LoggerInterface` penuh; di sini kontraknya sengaja
 * dipersempit jadi satu method `log()` (lihat `support/log.ts`). Karena itu
 * `RecordingLogger` di bawah hanya perlu satu method, bukan delapan.
 */

const BASE = 'https://gw.test';
const SESSION = 'sess-1';

interface LogRecord {
  level: string;
  message: string;
  context: Record<string, unknown>;
}

/** Logger yang merekam semuanya, untuk diperiksa test. */
class RecordingLogger implements LoggerLike {
  readonly records: LogRecord[] = [];

  log(level: string, message: string, context: Record<string, unknown> = {}): void {
    this.records.push({ level, message, context });
  }
}

/** Logger yang selalu gagal — pengiriman tetap harus jalan. */
class ThrowingLogger implements LoggerLike {
  log(): void {
    throw new Error('logger sedang rusak');
  }
}

/** Detik-detik yang diminta SDK untuk ditunggu, tanpa benar-benar menunggu. */
let slept: number[] = [];

function openWa(backend: MockBackend, extra: ConfigOptions = {}): OpenWA {
  return new OpenWA(
    { token: 'k', url: BASE, session: SESSION, ...extra },
    backend.executor(),
  );
}

function apiMe(backend: MockBackend, extra: ConfigOptions = {}): ApiMe {
  return new ApiMe(
    { token: 'tok', url: 'https://v14.test', instance: 'inst', ...extra },
    backend.executor(),
  );
}

/**
 * Satu pesan dengan indikator ketik menyala.
 *
 * `speed: 8` membuat pesan empat karakter meminta setengah detik, lalu dijepit
 * ke batas bawah dua detik — jadi durasinya pasti lebih dari nol dan
 * indikatornya benar-benar dikirim.
 */
function withTyping(destination: string): OutgoingMessage {
  return {
    destination,
    message: 'Halo',
    typing: { speed: 8, max: 30 },
  };
}

function rateLimited(retryAfter: number): Response {
  return new Response('{"message":"rate limited"}', {
    status: 429,
    headers: { 'Content-Type': 'application/json', 'Retry-After': String(retryAfter) },
  });
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
// Indikator "sedang mengetik" yang gagal
// ---------------------------------------------------------------------------

describe('logger — indikator ketik yang gagal', () => {
  /**
   * Kegagalan presence dicatat, lalu pesannya tetap dikirim. Urutannya
   * penting: kalau indikator gagal menahan pesan, logger ini justru merugikan
   * pemanggil.
   */
  test('indikator gagal dicatat tetapi pesan tetap terkirim', async () => {
    const logger = new RecordingLogger();

    const backend = new MockBackend([
      MockBackend.json({ message: 'presence tidak didukung' }, 500),
      MockBackend.json({ messageId: 'ABC' }),
    ]);

    const result = await openWa(backend, { logger }).sendMessage(withTyping('081234567890'));

    expect(backend.count()).toBe(2);
    expect(result).toBe('Sukses, messageId: ABC');

    expect(logger.records.length).toBe(1);

    const record = logger.records[0];

    expect(record.level).toBe('warning');
    expect(record.message).toContain('sedang mengetik');
    expect(record.context['provider']).toBe('OpenWA');

    // Tujuan dicatat seperti yang ditulis pemanggil, bukan bentuk yang sudah
    // dinormalkan gateway — itulah yang bisa ia kenali kembali.
    expect(record.context['destination']).toBe('081234567890');
    expect(String(record.context['error'])).toContain('presence tidak didukung');
  });

  /** Indikator yang berhasil bukan kejadian yang perlu dicatat. */
  test('indikator yang berhasil tidak dicatat', async () => {
    const logger = new RecordingLogger();

    const backend = new MockBackend([
      MockBackend.json({ success: true }),
      MockBackend.json({ messageId: 'ABC' }),
    ]);

    await openWa(backend, { logger }).sendMessage(withTyping('081234567890'));

    expect(logger.records).toEqual([]);

    // Durasinya tetap dihabiskan SDK sendiri, bukan oleh gateway.
    expect(slept).toEqual([2]);
  });

  /** Tanpa logger, jalur kirimnya berjalan persis seperti sebelumnya. */
  test('tanpa logger indikator gagal tetap senyap', async () => {
    const backend = new MockBackend([
      MockBackend.json({ message: 'presence tidak didukung' }, 500),
      MockBackend.json({ messageId: 'ABC' }),
    ]);

    const result = await openWa(backend).sendMessage(withTyping('081234567890'));

    expect(result).toBe('Sukses, messageId: ABC');

    // Indikator yang gagal tidak menambah jeda apa pun.
    expect(slept).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Percobaan ulang
// ---------------------------------------------------------------------------

describe('logger — percobaan ulang', () => {
  /**
   * Percobaan ulang yang tadinya senyap sekarang meninggalkan jejak: status,
   * jeda yang diminta gateway, dan sisa jatah. `remaining: 0` berarti jatah
   * setelah percobaan ini sudah habis — percobaan berikutnya tidak akan
   * terjadi.
   */
  test('percobaan ulang dicatat', async () => {
    const logger = new RecordingLogger();

    const backend = new MockBackend([
      rateLimited(5),
      MockBackend.json({ data: { id: 'm1' } }),
    ]);

    const result = await apiMe(backend, { retries: 1, logger }).sendMessage({
      destination: '081234567890',
      message: 'Halo',
    });

    expect(backend.count()).toBe(2);
    expect(result).toBe('Sukses, messageId: m1');
    expect(slept).toEqual([5]);

    expect(logger.records.length).toBe(1);

    const record = logger.records[0];

    expect(record.level).toBe('warning');
    expect(record.context['provider']).toBe('ApiMe');
    expect(record.context['status']).toBe(429);
    expect(record.context['retry_after']).toBe(5);
    expect(record.context['remaining']).toBe(0);
  });

  test('tanpa logger percobaan ulang tetap berjalan senyap', async () => {
    const backend = new MockBackend([
      rateLimited(5),
      MockBackend.json({ data: { id: 'm1' } }),
    ]);

    const result = await apiMe(backend, { retries: 1 }).sendMessage({
      destination: '081234567890',
      message: 'Halo',
    });

    expect(result).toBe('Sukses, messageId: m1');
    expect(backend.count()).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Logger tidak boleh bisa menggagalkan pengiriman
// ---------------------------------------------------------------------------

describe('logger — tidak bisa menggagalkan pengiriman', () => {
  /**
   * Ini satu-satunya alasan `Log.write()` menelan segalanya. Logger milik
   * pemanggil bisa saja menyentuh disk, jaringan, atau kode yang sedang rusak;
   * tidak satu pun boleh berubah menjadi kegagalan kirim.
   */
  test('logger yang melempar tidak mengganggu pengiriman', async () => {
    const backend = new MockBackend([
      MockBackend.json({ message: 'presence tidak didukung' }, 500),
      MockBackend.json({ messageId: 'ABC' }),
    ]);

    const result = await openWa(backend, { logger: new ThrowingLogger() }).sendMessage(
      withTyping('081234567890'),
    );

    expect(result).toBe('Sukses, messageId: ABC');
    expect(backend.count()).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Dari Client
// ---------------------------------------------------------------------------

describe('logger — diteruskan dari Client', () => {
  test('Client meneruskan logger ke provider', async () => {
    const logger = new RecordingLogger();

    const backend = new MockBackend([
      MockBackend.json({ message: 'presence tidak didukung' }, 500),
      MockBackend.json({ messageId: 'ABC' }),
    ]);

    await new Client(
      {
        provider: 'OpenWA',
        token: 'k',
        url: BASE,
        session: SESSION,
        logger,
      },
      backend.client(),
    ).send(withTyping('081234567890'));

    expect(logger.records.length).toBe(1);
    expect(logger.records[0].context['provider']).toBe('OpenWA');
  });
});
