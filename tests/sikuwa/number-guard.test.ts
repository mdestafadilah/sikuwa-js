import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Config, type ConfigOptions } from '../../src/lib/sikuwa/config';
import { Fonnte } from '../../src/lib/sikuwa/providers/fonnte/fonnte';
import { OpenWA } from '../../src/lib/sikuwa/providers/openwa/openwa';
import { type LoggerLike } from '../../src/lib/sikuwa/support/log';
import { MockBackend } from './mock-backend';

/**
 * Porting dari `tests/NumberGuardTest.php`.
 *
 * Yang diuji di sini bukan endpoint pemeriksanya — itu urusan
 * `number-check.test.ts` — melainkan perilaku jalur kirim saat penyaringnya
 * hidup: kapan request pemeriksaan muncul, apa yang terjadi pada tujuan yang
 * tidak terdaftar, dan apa yang dilaporkan ke pemanggil.
 *
 * Tiga janji yang paling penting untuk dijaga:
 *
 * 1. **Mati berarti tidak berubah sama sekali.** Selama `check_numbers` tidak
 *    dinyalakan, tidak ada satu pun request pemeriksaan yang muncul — kalau
 *    tidak, setiap pemanggil lama tiba-tiba mengirim dua kali lipat traffic.
 * 2. **Gagal berarti tetap kirim.** Pemeriksaan yang timeout tidak boleh
 *    menahan pesan; itu sebabnya `guardNumbers()` sengaja menelan error.
 * 3. **Hanya yang dipastikan tidak ada yang dibuang.** Nomor yang tidak
 *    disebut gateway berarti "belum diperiksa", bukan "tidak terdaftar".
 */

const BASE = 'https://gw.test';
const SESSION = 'sess-1';

/** Logger yang merekam semuanya, untuk diperiksa test. */
class GuardLogger implements LoggerLike {
  readonly records: Array<{
    level: string;
    message: string;
    context: Record<string, unknown>;
  }> = [];

  log(level: string, message: string, context: Record<string, unknown> = {}): void {
    this.records.push({ level, message, context });
  }
}

function fakeEnv(values: Record<string, string>): void {
  Config.useResolver((key) => values[key] ?? null);
}

function openWa(backend: MockBackend, options: ConfigOptions = {}): OpenWA {
  return new OpenWA(
    { token: 'k', url: BASE, session: SESSION, ...options },
    backend.executor(),
  );
}

beforeEach(() => {
  Config.useResolver(() => null);
});

afterEach(() => {
  Config.useResolver(null);
});

describe('check_numbers — saklar mati', () => {
  /**
   * Tanpa `check_numbers`, satu pesan tetap satu request. Ini penjaga regresi
   * untuk seluruh pemanggil yang tidak pernah meminta fitur ini.
   */
  test('fitur mati mengirim tanpa satu pun request pemeriksaan', async () => {
    const backend = new MockBackend([MockBackend.json({ messageId: 'M1' })]);

    const result = await openWa(backend).sendMessage({
      destination: '081234567890',
      message: 'halo',
    });

    expect(result).toBe('Sukses, messageId: M1');
    expect(backend.count()).toBe(1);
    expect(backend.lastUrl()).toContain('/messages/send-text');
  });

  /** Pilihan tegas `check_numbers: false` menang atas environment. */
  test('false eksplisit menang atas environment yang menyala', async () => {
    fakeEnv({ WHATSAPP_CHECK_NUMBERS: 'true' });

    const backend = new MockBackend([MockBackend.json({ messageId: 'M1' })]);

    const result = await openWa(backend, { check_numbers: false }).sendMessage({
      destination: '081234567890',
      message: 'halo',
    });

    expect(result).toBe('Sukses, messageId: M1');
    expect(backend.count()).toBe(1);
  });

  /** Saklar yang sama juga dibaca dari `WHATSAPP_CHECK_NUMBERS`. */
  test('environment menyalakan penyaring', async () => {
    fakeEnv({ WHATSAPP_CHECK_NUMBERS: 'true' });

    const backend = new MockBackend([
      MockBackend.json({ exists: true }),
      MockBackend.json({ messageId: 'M1' }),
    ]);

    await openWa(backend).sendMessage({
      destination: '081234567890',
      message: 'halo',
    });

    expect(backend.count()).toBe(2);
    expect(backend.urlAt(0)).toContain('/contacts/check/6281234567890');
  });
});

describe('check_numbers — saklar hidup', () => {
  /**
   * Pemeriksaan dikirim **sebelum** pengiriman, dan hasilnya terlihat dari
   * urutan request di backend: cek lebih dulu, baru send-text.
   */
  test('pemeriksaan berjalan sebelum pengiriman', async () => {
    const backend = new MockBackend([
      MockBackend.json({ exists: true }),
      MockBackend.json({ messageId: 'M2' }),
    ]);

    const result = await openWa(backend, { check_numbers: true }).sendMessage({
      destination: '081234567890',
      message: 'halo',
    });

    expect(result).toBe('Sukses, messageId: M2');
    expect(backend.count()).toBe(2);

    expect(backend.urlAt(0)).toContain('/contacts/check/6281234567890');
    expect(backend.urlAt(1)).toContain('/messages/send-text');
  });

  /**
   * Tujuan yang dipastikan tidak terdaftar dibuang, sisanya tetap dikirim, dan
   * jumlah yang dilewati dilaporkan di hasilnya.
   */
  test('tujuan tak terdaftar dilewati dan dilaporkan', async () => {
    const backend = new MockBackend([
      MockBackend.json({ exists: true }), // 081234567890 — dikirim
      MockBackend.json({ exists: false }), // 089876543210 — dibuang
      MockBackend.json({ messageId: 'M3' }),
    ]);

    const result = await openWa(backend, { check_numbers: true }).sendMessage([
      { destination: '081234567890', message: 'a' },
      { destination: '089876543210', message: 'b' },
    ]);

    // Dua pemeriksaan (satu per nomor) lalu satu pengiriman untuk sisa satu.
    expect(backend.count()).toBe(3);

    // Yang benar-benar terkirim hanya nomor yang terdaftar.
    expect(backend.lastJson()).toEqual({
      chatId: '6281234567890@c.us',
      text: 'a',
    });

    expect(result).toBe(
      'Sukses, messageId: M3 (1 tujuan dilewati karena tidak terdaftar: 089876543210)',
    );
  });

  /**
   * Bila semuanya tidak terdaftar, tidak ada request pengiriman sama sekali —
   * hanya pemeriksaan yang jalan.
   */
  test('semua tak terdaftar tidak mengirim apa pun', async () => {
    const backend = new MockBackend([MockBackend.json({ exists: false })]);

    const result = await openWa(backend, { check_numbers: true }).sendMessage({
      destination: '089876543210',
      message: 'halo',
    });

    expect(backend.count()).toBe(1);
    expect(result).toBe(
      'Tidak ada pesan terkirim: 1 tujuan dilewati karena tidak terdaftar di WhatsApp',
    );
  });

  /** Tujuan yang terverifikasi **tidak** boleh ikut dibuang. */
  test('tujuan terverifikasi tetap dikirim', async () => {
    const backend = new MockBackend([
      MockBackend.json({ exists: true }),
      MockBackend.json({ messageId: 'M4' }),
    ]);

    const result = await openWa(backend, { check_numbers: true }).sendMessage({
      destination: '081234567890',
      message: 'halo',
    });

    expect(result).toBe('Sukses, messageId: M4');
    expect(backend.lastJson()).toEqual({
      chatId: '6281234567890@c.us',
      text: 'halo',
    });
  });
});

describe('check_numbers — gagal berarti tetap kirim', () => {
  /**
   * Pemeriksaan yang timeout tidak boleh menahan pesan. Yang tersisa adalah
   * catatan peringatan ke logger, bukan exception.
   */
  test('pemeriksaan gagal diabaikan dan pesan tetap terkirim', async () => {
    const logger = new GuardLogger();

    const backend = new MockBackend([
      MockBackend.timeout(),
      MockBackend.json({ messageId: 'M5' }),
    ]);

    const result = await openWa(backend, {
      check_numbers: true,
      logger,
    }).sendMessage({ destination: '081234567890', message: 'halo' });

    expect(result).toBe('Sukses, messageId: M5');
    expect(backend.count()).toBe(2);

    expect(logger.records.length).toBeGreaterThan(0);
    expect(logger.records[0].level).toBe('warning');
    expect(logger.records[0].message).toContain('Pemeriksaan nomor sebelum kirim gagal');
  });

  /**
   * Kasus yang paling sering: endpoint cek OpenWA menuntut kunci berperan
   * operator, jadi akun berkunci baca ditolak HTTP 403. Penolakan itu tidak
   * boleh mematikan pengiriman — kirimnya sendiri baik-baik saja.
   */
  test('pemeriksaan 403 tetap mengirim pesan', async () => {
    const logger = new GuardLogger();

    const backend = new MockBackend([
      MockBackend.json({ error: 'forbidden' }, 403),
      MockBackend.json({ messageId: 'M9' }),
    ]);

    const result = await openWa(backend, {
      check_numbers: true,
      logger,
    }).sendMessage({ destination: '081234567890', message: 'halo' });

    expect(result).toBe('Sukses, messageId: M9');
    expect(backend.count()).toBe(2);
    expect(backend.lastUrl()).toContain('/messages/send-text');
    expect(logger.records.length).toBeGreaterThan(0);
  });
});

describe('check_numbers — yang tidak bisa diperiksa tidak diperiksa', () => {
  /**
   * Tujuan berbentuk JID (grup) tidak punya padanan nomor, jadi tidak ikut
   * diperiksa — dan karena tidak ada satu pun yang bisa diperiksa, tidak ada
   * request pemeriksaan sama sekali.
   */
  test('tujuan grup tidak diperiksa', async () => {
    const backend = new MockBackend([MockBackend.json({ messageId: 'M6' })]);

    const result = await openWa(backend, { check_numbers: true }).sendMessage({
      destination: '120363000000000000@g.us',
      message: 'halo grup',
    });

    expect(result).toBe('Sukses, messageId: M6');
    expect(backend.count()).toBe(1);
    expect(backend.lastUrl()).toContain('/messages/send-text');
  });
});

describe('check_numbers — bentuk laporan', () => {
  /**
   * Daftar contoh dipotong: satu batch besar tidak boleh membanjiri hasil
   * dengan ratusan nomor. Yang tampil cukup lima, sisanya diringkas.
   */
  test('daftar contoh dibatasi lima nomor', async () => {
    const responses = [];

    for (let i = 1; i <= 6; i++) responses.push(MockBackend.json({ exists: false }));

    responses.push(MockBackend.json({ exists: true }));
    responses.push(MockBackend.json({ messageId: 'M7' }));

    const backend = new MockBackend(responses);
    const messages = [];

    for (let i = 1; i <= 6; i++) {
      messages.push({ destination: `08900000000${i}`, message: 'x' });
    }

    messages.push({ destination: '081234567890', message: 'y' });

    const result = await openWa(backend, { check_numbers: true }).sendMessage(messages);

    expect(result).toBe(
      'Sukses, messageId: M7 (6 tujuan dilewati karena tidak terdaftar: ' +
        '089000000001, 089000000002, 089000000003, 089000000004, 089000000005' +
        ' dan 1 lainnya)',
    );
  });

  /** Melewati tujuan dicatat ke logger, supaya penyaringan tidak senyap. */
  test('melewati tujuan dicatat sebagai warning', async () => {
    const logger = new GuardLogger();

    const backend = new MockBackend([
      MockBackend.json({ exists: false }), // 089876543210 — dibuang
      MockBackend.json({ exists: true }), // 081234567890 — dikirim
      MockBackend.json({ messageId: 'M8' }),
    ]);

    await openWa(backend, { check_numbers: true, logger }).sendMessage([
      { destination: '089876543210', message: 'a' },
      { destination: '081234567890', message: 'b' },
    ]);

    expect(logger.records.length).toBeGreaterThan(0);

    const terakhir = logger.records[logger.records.length - 1];

    expect(terakhir.level).toBe('warning');
    expect(terakhir.message).toContain('tidak terdaftar dilewati');
    expect(terakhir.context['dilewati']).toBe(1);
  });
});

describe('check_numbers — titik panggil kedua: Fonnte', () => {
  /**
   * Fonnte memanggil `plan()` sendiri, bukan lewat `sendIndividually()`, jadi
   * penyaringnya harus terpasang di sana juga. Fonnte memeriksa seluruh daftar
   * dalam satu request, lalu mengirim sisanya dalam satu request.
   */
  test('Fonnte menyaring sebelum mengirim', async () => {
    const backend = new MockBackend([
      MockBackend.json({
        status: true,
        registered: ['6281234567890'],
        not_registered: ['6289876543210'],
      }),
      MockBackend.json({ status: true, detail: '1/1' }),
    ]);

    const result = await new Fonnte(
      { token: 'tok', check_numbers: true },
      backend.executor(),
    ).sendMessage([
      { destination: '081234567890', message: 'a' },
      { destination: '089876543210', message: 'b' },
    ]);

    expect(backend.count()).toBe(2);
    expect(backend.urlAt(0)).toBe('https://api.fonnte.com/validate');
    expect(backend.urlAt(1)).toBe('https://api.fonnte.com/send');

    // Body kirim hanya memuat satu target — yang terdaftar.
    const terkirim = JSON.parse(backend.lastForm()['data'] ?? '[]') as Array<{
      target: string;
    }>;

    expect(terkirim.length).toBe(1);
    expect(terkirim[0].target).toBe('081234567890');

    expect(result).toContain('1 tujuan dilewati');
  });
});
