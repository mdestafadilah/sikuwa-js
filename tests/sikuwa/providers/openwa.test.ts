import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Config, type ConfigOptions } from '../../../src/lib/sikuwa/config';
import {
  ApiException,
  AuthException,
  ConfigurationException,
  TimeoutException,
} from '../../../src/lib/sikuwa/exceptions';
import { AbstractProvider } from '../../../src/lib/sikuwa/providers/abstract-provider';
import { OpenWA } from '../../../src/lib/sikuwa/providers/openwa/openwa';
import { MockBackend } from '../mock-backend';

/**
 * Porting dari `tests/Providers/OpenWATest.php`, ditambah bagian yang tidak
 * ada di versi PHP (pengiriman berkas, presence, dan sesi).
 *
 * OpenWA diporting kedua karena ia satu-satunya gateway self-hosted yang
 * **tidak** memakai `sendIndividually()`: ia punya endpoint batch sendiri.
 * Itu membuatnya berbagi bentuk dengan Fonnte, bukan dengan ApiMe dan
 * kawan-kawan. Yang dijaga test ini adalah aturan-aturan yang khas OpenWA:
 * `chatId` wajib berupa JID lengkap, jeda batch dihitung dari pesan kedua,
 * dan amplop NestJS yang menaruh pesannya di `message`.
 */

const BASE = 'https://gw.test';
const SESSION = 'sess-1';

function fakeEnv(values: Record<string, string>): void {
  Config.useResolver((key) => values[key] ?? null);
}

/** Jalankan `run`, dan kembalikan exception yang dilempar. */
async function capture(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }

  throw new Error('Seharusnya melempar exception, tapi berhasil');
}

function provider(backend: MockBackend, options: ConfigOptions = {}): OpenWA {
  return new OpenWA(
    { token: 'api-key', url: BASE, session: SESSION, ...options },
    backend.executor(),
  );
}

beforeEach(() => {
  Config.useResolver(() => null);
  AbstractProvider.useSleeper(null);
});

afterEach(() => {
  Config.useResolver(null);
  AbstractProvider.useSleeper(null);
});

describe('OpenWA — pengiriman teks', () => {
  test('satu pesan menuju endpoint send-text', async () => {
    const backend = new MockBackend([MockBackend.json({ messageId: '3EB0ABC' })]);

    const result = await provider(backend).sendMessage({
      destination: '081234567890',
      message: 'halo',
    });

    expect(result).toBe('Sukses, messageId: 3EB0ABC');
    expect(backend.lastUrl()).toBe(`${BASE}/api/sessions/${SESSION}/messages/send-text`);
    expect(backend.methodAt(0)).toBe('POST');
    expect(backend.lastHeader('X-API-Key')).toBe('api-key');
    expect(backend.lastJson()).toEqual({
      chatId: '6281234567890@c.us',
      text: 'halo',
    });
  });

  test('lebih dari satu pesan menuju endpoint send-bulk', async () => {
    const backend = new MockBackend([
      MockBackend.json({ totalMessages: 2, batchId: 'batch-9' }),
    ]);

    const result = await provider(backend).sendMessage([
      { destination: '0811', message: 'a' },
      { destination: '0822', message: 'b' },
    ]);

    expect(result).toBe('Batch diterima (2 pesan), batchId: batch-9');
    expect(backend.lastUrl()).toBe(`${BASE}/api/sessions/${SESSION}/messages/send-bulk`);

    const payload = backend.lastJson();

    expect(payload['messages']).toEqual([
      { chatId: '62811@c.us', type: 'text', content: { text: 'a' } },
      { chatId: '62822@c.us', type: 'text', content: { text: 'b' } },
    ]);

    // Tanpa delay eksplisit, jeda bawaan 3 detik dipakai.
    expect(payload['options']).toEqual({
      delayBetweenMessages: 3000,
      randomizeDelay: true,
      stopOnError: false,
    });
  });

  test('jeda batch dijepit ke rentang yang diterima gateway', async () => {
    const backend = new MockBackend([
      MockBackend.json({ totalMessages: 2, batchId: 'b' }),
    ]);

    await provider(backend).sendMessage([
      { destination: '0811', message: 'a', delay: 0 },
      { destination: '0822', message: 'b' },
    ]);

    // `delayBetweenMessages` dibatasi 1000-60000 milidetik oleh OpenWA, dan
    // jeda pesan kedua (null) jatuh ke jeda pesan pertama (0) sebelum dijepit.
    expect(backend.lastJson()['options']).toEqual({
      delayBetweenMessages: 1000,
      randomizeDelay: true,
      stopOnError: false,
    });
  });

  test('jeda batch memakai jeda pesan kedua, bukan pesan pertama', async () => {
    const backend = new MockBackend([
      MockBackend.json({ totalMessages: 2, batchId: 'b' }),
    ]);

    await provider(backend).sendMessage([
      { destination: '0811', message: 'a', delay: 1 },
      { destination: '0822', message: 'b', delay: 12 },
    ]);

    // 12 detik dari pesan KEDUA yang menang: itu jeda yang benar-benar
    // terasa di antara dua pesan, sedangkan jeda pesan pertama hanya
    // menunda mulainya batch.
    expect(backend.lastJson()['options']).toMatchObject({
      delayBetweenMessages: 12000,
    });
  });

  test('sesi yang belum diisi ditolak sebelum ada request', async () => {
    const backend = new MockBackend([]);

    await expect(
      provider(backend, { session: '' }).sendMessage({
        destination: '0811',
        message: 'a',
      }),
    ).rejects.toThrow('WHATSAPP_SESSION belum diisi di .env');

    expect(backend.count()).toBe(0);
  });

  test('nomor tujuan yang tidak bisa dibaca ditolak', async () => {
    const backend = new MockBackend([]);

    await expect(
      provider(backend).sendMessage({ destination: 'abc', message: 'a' }),
    ).rejects.toThrow('tidak punya nomor tujuan yang valid');

    expect(backend.count()).toBe(0);
  });

  test('lebih dari 100 pesan ditolak', async () => {
    const backend = new MockBackend([]);
    const messages = Array.from({ length: 101 }, () => ({
      destination: '0811',
      message: 'a',
    }));

    await expect(provider(backend).sendMessage(messages)).rejects.toThrow(
      'OpenWA membatasi 100 pesan per batch',
    );
  });
});

describe('OpenWA — terjemahan kegagalan', () => {
  test('pesan error amplop NestJS dipakai apa adanya', async () => {
    const backend = new MockBackend([
      MockBackend.json({ statusCode: 400, message: 'chatId tidak valid' }, 400),
    ]);

    const error = await capture(() =>
      provider(backend).sendMessage({ destination: '0811', message: 'a' }),
    );

    expect(error).toBeInstanceOf(ApiException);
    expect((error as ApiException).message).toBe(
      'OpenWA menolak pesan (HTTP 400): chatId tidak valid',
    );
  });

  test('daftar pesan validasi diratakan menjadi satu kalimat', async () => {
    const backend = new MockBackend([
      MockBackend.json(
        { statusCode: 400, message: ['chatId harus diisi', 'text terlalu panjang'] },
        400,
      ),
    ]);

    const error = await capture(() =>
      provider(backend).sendMessage({ destination: '0811', message: 'a' }),
    );

    expect((error as ApiException).message).toContain(
      'chatId harus diisi; text terlalu panjang',
    );
  });

  test('HTTP 401 menjadi AuthException', async () => {
    const backend = new MockBackend([
      MockBackend.json({ statusCode: 401, message: 'nope' }, 401),
    ]);

    await expect(
      provider(backend).sendMessage({ destination: '0811', message: 'a' }),
    ).rejects.toThrow(AuthException);
  });

  test('timeout dilaporkan sebagai TimeoutException', async () => {
    const backend = new MockBackend([MockBackend.timeout()]);

    await expect(
      provider(backend).sendMessage({ destination: '0811', message: 'a' }),
    ).rejects.toThrow(TimeoutException);
  });

  test('kegagalan koneksi menyebut nama gateway', async () => {
    const backend = new MockBackend([MockBackend.connectionFailure()]);

    await expect(
      provider(backend).sendMessage({ destination: '0811', message: 'a' }),
    ).rejects.toThrow('Gagal menghubungi OpenWA');
  });

  test('respons 2xx yang bukan JSON tidak dilaporkan sebagai sukses', async () => {
    const backend = new MockBackend([MockBackend.raw('<html>oops</html>')]);

    await expect(
      provider(backend).sendMessage({ destination: '0811', message: 'a' }),
    ).rejects.toThrow('Respons OpenWA tidak valid');
  });
});

describe('OpenWA — konfigurasi dari environment', () => {
  test('URL dan sesi dibaca dari environment', async () => {
    fakeEnv({
      WHATSAPP_URL: 'http://env.test/',
      WHATSAPP_SESSION: 'dari-env',
      WHATSAPP_TOKEN: 'tok-env',
    });

    const backend = new MockBackend([MockBackend.json({ messageId: 'x' })]);

    await new OpenWA(null, backend.executor()).sendMessage({
      destination: '0811',
      message: 'a',
    });

    // `rtrim($url, '/')` PHP membuang SEMUA garis miring di ujung, jadi
    // "http://env.test/" tidak boleh menghasilkan "//api/...".
    expect(backend.lastUrl()).toBe(
      'http://env.test/api/sessions/dari-env/messages/send-text',
    );
    expect(backend.lastHeader('X-API-Key')).toBe('tok-env');
  });

  test('WHATSAPP_SESSION_OpenWA menang atas WHATSAPP_SESSION bersama', async () => {
    fakeEnv({
      WHATSAPP_SESSION: 'sesi-bersama',
      WHATSAPP_SESSION_OpenWA: 'sesi-openwa',
      WHATSAPP_TOKEN_OpenWA: 'key-env',
    });

    const backend = new MockBackend([MockBackend.json({ messageId: 'x' })]);

    await new OpenWA(null, backend.executor()).sendMessage({
      destination: '0811',
      message: 'a',
    });

    // Supaya OpenWA, Wwebjs, dan Waxum bisa memakai nama session masing-masing
    // dalam satu aplikasi.
    expect(backend.lastUrl()).toContain('/api/sessions/sesi-openwa/messages/send-text');
  });

  test('WHATSAPP_URL_OpenWA menang atas WHATSAPP_URL bersama', async () => {
    fakeEnv({
      WHATSAPP_URL: 'https://bersama.test',
      WHATSAPP_URL_OpenWA: 'https://openwa.test',
      WHATSAPP_SESSION: 'sess-env',
      WHATSAPP_TOKEN_OpenWA: 'key-env',
    });

    const backend = new MockBackend([MockBackend.json({ messageId: 'x' })]);

    await new OpenWA(null, backend.executor()).sendMessage({
      destination: '0811',
      message: 'a',
    });

    expect(backend.lastUrl()).toBe(
      'https://openwa.test/api/sessions/sess-env/messages/send-text',
    );
  });

  test('id sesi di-escape saat masuk URL', async () => {
    const backend = new MockBackend([MockBackend.json({ messageId: 'x' })]);

    await provider(backend, { session: 'a/b c' }).sendMessage({
      destination: '0811',
      message: 'a',
    });

    // Tanpa escape, "a/b c" akan menjadi dua segmen path dan menabrak
    // endpoint yang sama sekali berbeda.
    expect(backend.lastUrl()).toContain('a%2Fb%20c');
    expect(backend.lastUrl()).toContain('/messages/send-text');
  });
});

describe('OpenWA — berkas', () => {
  test('gambar dikirim ke send-image sebagai base64 mentah', async () => {
    const backend = new MockBackend([MockBackend.json({ messageId: 'img-1' })]);

    const result = await provider(backend).sendImage({
      destination: '081234567890',
      image: 'data:image/png;base64,QUJD',
      filename: 'foto.png',
      caption: 'lihat ini',
    });

    expect(result).toBe('Sukses, messageId: img-1');
    expect(backend.lastUrl()).toBe(
      `${BASE}/api/sessions/${SESSION}/messages/send-image`,
    );
    // Awalan `data:…;base64,` harus DIBUANG: OpenWA menerima base64 mentah
    // dan mengirim mimenya di kolom sendiri. Mengirim data URI utuh akan
    // ditolak, dan itu kesalahan yang mudah terjadi karena `File.dataUri()`
    // justru bentuk yang dipakai gateway lain.
    expect(backend.lastJson()).toEqual({
      chatId: '6281234567890@c.us',
      mimetype: 'image/png',
      filename: 'foto.png',
      caption: 'lihat ini',
      base64: 'QUJD',
    });
  });

  test('dokumen dikirim ke send-document', async () => {
    const backend = new MockBackend([MockBackend.json({ messageId: 'doc-1' })]);

    await provider(backend).sendFile({
      destination: '081234567890',
      file: 'data:application/pdf;base64,QUJD',
      filename: 'laporan.pdf',
    });

    expect(backend.lastUrl()).toBe(
      `${BASE}/api/sessions/${SESSION}/messages/send-document`,
    );
    expect(backend.lastJson()).toMatchObject({
      mimetype: 'application/pdf',
      filename: 'laporan.pdf',
      base64: 'QUJD',
    });
  });

  test('URL publik dikirim sebagai url, bukan base64', async () => {
    const backend = new MockBackend([MockBackend.json({ messageId: 'u-1' })]);

    await provider(backend).sendImage({
      destination: '0811',
      image: 'https://contoh.test/foto.png',
      filename: 'foto.png',
    });

    // Kalau sumbernya URL, server OpenWA yang mengunduh — mengirim keduanya
    // sekaligus hanya menggandakan beban tanpa menambah apa pun.
    expect(backend.lastJson()).toEqual({
      chatId: '62811@c.us',
      mimetype: 'image/png',
      filename: 'foto.png',
      url: 'https://contoh.test/foto.png',
    });
  });

  test('nomor tujuan berkas yang tidak valid ditolak sebelum request', async () => {
    const backend = new MockBackend([]);

    await expect(
      provider(backend).sendImage({
        destination: 'abc',
        image: 'data:image/png;base64,QUJD',
        filename: 'foto.png',
      }),
    ).rejects.toThrow("Nomor tujuan 'abc' tidak valid");

    expect(backend.count()).toBe(0);
  });
});

describe('OpenWA — indikator ketik', () => {
  test('composing menjadi state typing', async () => {
    const backend = new MockBackend([MockBackend.json({ success: true })]);

    const result = await provider(backend).sendTyping({
      destination: '081234567890',
      state: 'composing',
      duration: 5,
    });

    expect(backend.lastUrl()).toBe(`${BASE}/api/sessions/${SESSION}/chats/typing`);
    expect(backend.lastJson()).toEqual({ chatId: '6281234567890@c.us', state: 'typing' });
    expect(result).toContain('indikator');
  });

  test('paused menjadi state paused', async () => {
    const backend = new MockBackend([MockBackend.json({ success: true })]);

    await provider(backend).sendTyping({ destination: '0811', state: 'paused' });

    expect(backend.lastJson()).toEqual({ chatId: '62811@c.us', state: 'paused' });
  });

  test('recording diterjemahkan, bukan ditolak', async () => {
    const backend = new MockBackend([MockBackend.json({ success: true })]);

    // `duration` wajib untuk keadaan selain `paused` — aturan bersama seluruh
    // gateway, bukan aturan OpenWA. Fonnte dan Evolution API memakainya untuk
    // menentukan berapa lama indikatornya tampil, jadi `Presence.from()`
    // menolaknya lebih awal alih-alih membiarkan gateway diam-diam tidak
    // menampilkan apa pun.
    await provider(backend).sendTyping({
      destination: '0811',
      state: 'recording',
      duration: 5,
    });

    // OpenWA memang punya indikator merekam suara — berbeda dari Fonnte yang
    // menolaknya. Karena itu kosakata bakunya harus diterjemahkan di sini.
    expect(backend.lastJson()).toEqual({ chatId: '62811@c.us', state: 'recording' });
  });
});

describe('OpenWA — sesi', () => {
  test('createSession mengirim id dari WHATSAPP_SESSION', async () => {
    const backend = new MockBackend([
      MockBackend.json({ id: 'sess-1', status: 'INITIALIZING' }),
    ]);

    const session = await provider(backend).createSession();

    expect(backend.lastUrl()).toBe(`${BASE}/api/sessions`);
    expect(backend.lastJson()).toEqual({ id: 'sess-1' });
    expect(session.status).toBe('INITIALIZING');
    // Sesi yang baru dibuat belum bisa dipakai mengirim.
    expect(session.isConnected()).toBe(false);
  });

  test('checkSession membaca status dari amplop data', async () => {
    const backend = new MockBackend([
      MockBackend.json({
        success: true,
        data: { id: 'sess-1', status: 'connected', phoneNumber: '62811' },
      }),
    ]);

    const session = await provider(backend).checkSession();

    expect(session.status).toBe('CONNECTED');
    expect(session.isConnected()).toBe(true);
    expect(session.phoneNumber).toBe('62811');
  });

  test('showQr membaca qrCode sebagai data URI', async () => {
    const backend = new MockBackend([
      MockBackend.json({ qrCode: 'data:image/png;base64,QUJD', status: 'qr_ready' }),
    ]);

    const session = await provider(backend).showQr();

    expect(backend.lastUrl()).toBe(`${BASE}/api/sessions/${SESSION}/qr`);
    expect(session.qr).toBe('data:image/png;base64,QUJD');
    expect(session.hasQr()).toBe(true);
    // Endpoint ini hanya menjawab kalau sesinya belum tersambung.
    expect(session.isConnected()).toBe(false);
  });

  test('checkSession menolak id sesi yang kosong', async () => {
    const backend = new MockBackend([]);

    await expect(provider(backend, { session: '' }).checkSession()).rejects.toThrow(
      ConfigurationException,
    );
  });
});
