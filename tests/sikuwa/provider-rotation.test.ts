import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Client } from '../../src/lib/sikuwa/client';
import { Config, type ConfigOptions } from '../../src/lib/sikuwa/config';
import { ApiException, ConfigurationException } from '../../src/lib/sikuwa/exceptions';
import { AbstractProvider } from '../../src/lib/sikuwa/providers/abstract-provider';
import { type LoggerLike } from '../../src/lib/sikuwa/support/log';
import { MockBackend } from './mock-backend';

/**
 * Porting dari `tests/ProviderRotationTest.php`.
 *
 * Mode `auto` hanya mengundi **sekali per panggilan**, jadi satu `send()` berisi
 * seratus pesan tetap keluar lewat satu gateway saja. Dengan `WHATSAPP_ROTATE`
 * menyala, batch itu dibagi ke semua gateway yang punya token.
 *
 * Yang paling penting dibuktikan di sini bukan pembagiannya, melainkan bahwa
 * **tanpa saklarnya jalur kirimnya tidak berubah sama sekali** — batch tetap
 * utuh di satu gateway. Karena itu tiap perilaku diuji berpasangan.
 *
 * Dua gateway dipakai karena bentuknya berbeda: OpenWA menerima seluruh
 * potongan dalam satu request, wuzapi mengirim satu pesan per request. Yang
 * diperiksa karena itu bukan jumlah request, melainkan **nomor tujuan mana
 * mendarat di gateway mana** — dibaca dari body request, sehingga tetap sah
 * untuk kedua bentuk.
 */

const OWA = 'https://openwa.test';
const WUZ = 'https://wuzapi.test';

interface LogRecord {
  level: string;
  message: string;
  context: Record<string, unknown>;
}

class RecordingLogger implements LoggerLike {
  readonly records: LogRecord[] = [];

  log(level: string, message: string, context: Record<string, unknown> = {}): void {
    this.records.push({ level, message, context });
  }
}

let slept: number[] = [];

function fakeEnv(values: Record<string, string>): void {
  Config.useResolver((key) => values[key] ?? null);
}

function options(extra: ConfigOptions = {}): ConfigOptions {
  return {
    provider: 'auto',
    tokens: { OpenWA: 'owa-key', Wuzapi: 'wuz-token' },
    urls: { OpenWA: OWA, Wuzapi: WUZ },
    sessions: { OpenWA: ['owa-session'] },
    ...extra,
  };
}

/**
 * Balasan yang diterima OpenWA maupun wuzapi sekaligus.
 *
 * Keduanya memakai amplop yang berbeda — OpenWA membaca `messageId` atau
 * `totalMessages`, wuzapi mewajibkan `success` — jadi badannya digabungkan
 * daripada membuat dua antrean yang harus ditebak urutannya.
 */
function responses(jumlah = 8): Response[] {
  const satu = () =>
    MockBackend.json({
      success: true,
      messageId: '3EB0',
      totalMessages: 1,
      batchId: 'batch-1',
      data: { Id: '3EB0' },
    });

  return Array.from({ length: jumlah }, satu);
}

/** Nomor tujuan yang tidak saling mengandung. */
function nomor(jumlah: number): string[] {
  return Array.from(
    { length: jumlah },
    (_, i) => `6281200000${String(i + 1).padStart(3, '0')}`,
  );
}

function batch(daftar: string[]): Array<{ destination: string; message: string }> {
  return daftar.map((n) => ({ destination: n, message: 'halo' }));
}

/**
 * Nomor tujuan mana mendarat di gateway mana, dibaca dari body request.
 *
 * @returns host → nomor tujuan, dalam urutan kemunculannya.
 */
function rute(backend: MockBackend, daftar: string[]): Record<string, string[]> {
  const hasil: Record<string, string[]> = {};

  for (const request of backend.requests) {
    const host = new URL(request.url).hostname;

    for (const n of daftar) {
      if (request.text.includes(n)) (hasil[host] ??= []).push(n);
    }
  }

  return hasil;
}

/**
 * `delayBetweenMessages` yang benar-benar dikirim ke OpenWA, dalam milidetik —
 * bukti bahwa pengaturan amplop sampai ke potongannya.
 */
function delayOpenWA(backend: MockBackend): number | null {
  for (const request of backend.requests) {
    if (new URL(request.url).hostname !== 'openwa.test') continue;

    const body = JSON.parse(request.text) as {
      options?: { delayBetweenMessages?: number };
    };

    return body.options?.delayBetweenMessages ?? null;
  }

  return null;
}

beforeEach(() => {
  slept = [];
  AbstractProvider.useSleeper((seconds) => {
    slept.push(seconds);
  });

  // Environment dikosongkan supaya kunci asli di mesin ini tidak ikut terbaca:
  // seluruh pengaturan di berkas ini lewat opsi, bukan .env.
  fakeEnv({});
});

afterEach(() => {
  AbstractProvider.useSleeper(null);
  Config.useResolver(null);
});

// ---------------------------------------------------------------------------
// Tanpa rotasi: perilakunya harus sama persis seperti sebelumnya
// ---------------------------------------------------------------------------

describe('rotasi — tanpa saklar', () => {
  test('seluruh batch tetap lewat satu gateway', async () => {
    const backend = new MockBackend(responses());
    const daftar = nomor(4);

    const result = await new Client(options(), backend.client()).send(batch(daftar));

    const hasilRute = rute(backend, daftar);
    const hosts = Object.keys(hasilRute);

    expect(hosts.length).toBe(1);
    expect(hasilRute[hosts[0]]).toEqual(daftar);
    expect(result).not.toContain('gateway');
  });

  test('satu pesan tidak pernah dirotasi', async () => {
    const backend = new MockBackend(responses());

    const result = await new Client(options({ rotate: true }), backend.client()).send({
      destination: '6281200000001',
      message: 'halo',
    });

    expect(backend.count()).toBe(1);
    expect(result).not.toContain('gateway');
  });

  /**
   * Daftar berisi satu pesan tidak punya apa pun untuk dibagi, jadi ia lewat
   * jalur lama — dan tidak boleh menuntut `provider = auto`.
   */
  test('batch berisi satu pesan tidak dirotasi', async () => {
    const backend = new MockBackend(responses());

    const result = await new Client(
      options({ provider: 'OpenWA', rotate: true }),
      backend.client(),
    ).send([{ destination: '6281200000001', message: 'halo' }]);

    expect(backend.count()).toBe(1);
    expect(result).not.toContain('gateway');
  });
});

// ---------------------------------------------------------------------------
// Dengan rotasi: batch benar-benar dibagi
// ---------------------------------------------------------------------------

describe('rotasi — dengan saklar', () => {
  test('batch dibagi ke setiap gateway yang terkonfigurasi', async () => {
    const backend = new MockBackend(responses());
    const daftar = nomor(4);

    const result = await new Client(options({ rotate: true }), backend.client()).send(
      batch(daftar),
    );

    const hasilRute = rute(backend, daftar);

    expect(Object.keys(hasilRute).length).toBe(2);
    expect(Object.values(hasilRute).map((n) => n.length)).toEqual([2, 2]);

    const semua = Object.values(hasilRute).flat().sort();

    expect(semua).toEqual(daftar);

    expect(result).toContain('4/4 pesan terkirim lewat 2 gateway');
    expect(result).toContain('OpenWA 2');
    expect(result).toContain('Wuzapi 2');
  });

  test('pembagian tetap seimbang saat batch tidak habis dibagi', async () => {
    const backend = new MockBackend(responses(12));
    const daftar = nomor(7);

    await new Client(options({ rotate: true }), backend.client()).send(batch(daftar));

    const jumlah = Object.values(rute(backend, daftar))
      .map((n) => n.length)
      .sort((a, b) => a - b);

    expect(jumlah).toEqual([3, 4]);
  });

  test('kunci environment menyalakan rotasi', async () => {
    fakeEnv({
      WHATSAPP_PROVIDER: 'auto',
      WHATSAPP_ROTATE: '1',
      WHATSAPP_TOKEN_OpenWA: 'owa-key',
      WHATSAPP_TOKEN_Wuzapi: 'wuz-token',
      WHATSAPP_URL_OpenWA: OWA,
      WHATSAPP_URL_Wuzapi: WUZ,
      WHATSAPP_SESSION_OpenWA: 'owa-session',
    });

    const backend = new MockBackend(responses());
    const daftar = nomor(4);

    await new Client({}, backend.client()).send(batch(daftar));

    expect(Object.keys(rute(backend, daftar)).length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Pengaturan tingkat panggilan ikut ke tiap potongan
// ---------------------------------------------------------------------------

describe('rotasi — pengaturan amplop ikut ke tiap potongan', () => {
  /**
   * `pacing` ditulis pemanggil di amplop, jadi ia berlaku untuk seluruh batch —
   * dan batch itu sekarang dipecah. Kalau pengaturannya tidak ikut dipindahkan,
   * potongan kedua dan seterusnya kembali ke jeda bawaan gateway: tepat di
   * bagian yang paling butuh dijeda.
   */
  test('pacing amplop sampai ke setiap potongan', async () => {
    const backend = new MockBackend(responses());

    await new Client(options({ rotate: true }), backend.client()).send({
      messages: batch(nomor(4)),
      pacing: { cycle: '0,30' },
    });

    // Tiap potongan berisi dua pesan, jadi tiap potongan punya satu jeda 30
    // detik di posisi kedua — dan hanya wuzapi, yang mengirim satu per satu,
    // benar-benar menunggunya.
    expect(slept).toEqual([30]);

    // OpenWA hanya menerima satu angka jeda untuk seluruh batch, dan yang
    // dipakai adalah jeda pesan kedua: 30 detik. Tanpa pengaturan amplopnya,
    // angka ini kembali ke bawaan 3 detik.
    expect(delayOpenWA(backend)).toBe(30000);
  });

  /**
   * Bentuk daftar yang menaruh kunci pengaturan di sebelah pesannya —
   * `['pacing' => [...], [...], [...]]` — harus diperlakukan sama seperti
   * bentuk amplop, karena itulah bentuk yang tidak punya tempat lain.
   */
  test('pengaturan di samping daftar juga sampai ke tiap potongan', async () => {
    const backend = new MockBackend(responses());

    const pesan = Object.assign(batch(nomor(4)), { pacing: { cycle: '0,30' } });

    await new Client(options({ rotate: true }), backend.client()).send(
      pesan as unknown as Parameters<Client['send']>[0],
    );

    expect(delayOpenWA(backend)).toBe(30000);
  });
});

// ---------------------------------------------------------------------------
// Batas dan kegagalannya
// ---------------------------------------------------------------------------

describe('rotasi — batas dan kegagalan', () => {
  test('rotasi menolak provider tetap', async () => {
    const backend = new MockBackend(responses());

    const client = new Client(
      options({ provider: 'OpenWA', rotate: true }),
      backend.client(),
    );

    const error = await client.send(batch(nomor(2))).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConfigurationException);
    expect((error as Error).message).toContain('WHATSAPP_ROTATE');
    expect((error as Error).message).toContain('WHATSAPP_PROVIDER=auto');

    // Tidak ada satu pun request yang berangkat.
    expect(backend.count()).toBe(0);
  });

  test('rotasi tanpa provider ditolak', async () => {
    const client = new Client({ rotate: true }, new MockBackend(responses()).client());

    const error = await client.send(batch(nomor(2))).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConfigurationException);
    expect((error as Error).message).toContain('WHATSAPP_PROVIDER belum diisi');
  });

  /**
   * Satu gateway bertoken bukan kegagalan — mode `auto` tetap jalan, rotasi
   * cuma tidak punya pilihan. Yang tidak boleh terjadi adalah pemanggil
   * mengira batchnya sudah dibagi padahal tidak, jadi kejadian ini dicatat ke
   * logger.
   */
  test('rotasi jatuh ke satu gateway dan mengatakannya di log', async () => {
    const backend = new MockBackend(responses());
    const logger = new RecordingLogger();
    const daftar = nomor(3);

    const result = await new Client(
      options({ rotate: true, tokens: { OpenWA: 'owa-key' }, logger }),
      backend.client(),
    ).send(batch(daftar));

    const hasilRute = rute(backend, daftar);

    expect(Object.keys(hasilRute).length).toBe(1);
    expect(hasilRute['openwa.test']).toEqual(daftar);
    expect(result).not.toContain('gateway');

    expect(logger.records.length).toBe(1);
    expect(logger.records[0].level).toBe('warning');
    expect(logger.records[0].message).toContain('hanya satu gateway');
  });

  /**
   * Potongan yang gagal dilaporkan bersama nama gatewaynya, dan potongan lain
   * tetap dicoba — satu gateway yang sedang bermasalah tidak boleh menahan
   * bagian yang sudah dibagi kepadanya.
   */
  test('potongan yang gagal dilaporkan dengan nama gatewaynya', async () => {
    const backend = new MockBackend(
      Array.from({ length: 8 }, () => MockBackend.json({ error: 'boom' }, 500)),
    );

    const client = new Client(options({ rotate: true }), backend.client());

    const error = await client.send(batch(nomor(4))).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiException);
    expect((error as Error).message).toContain('0/4 pesan terkirim');
    expect((error as Error).message).toContain('OpenWA: ');
    expect((error as Error).message).toContain('Wuzapi: ');

    // Kedua potongan tetap dicoba.
    expect(backend.count()).toBeGreaterThan(1);
  });
});
