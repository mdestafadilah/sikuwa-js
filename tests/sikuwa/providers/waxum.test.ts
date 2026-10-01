import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Config, type ConfigOptions } from '../../../src/lib/sikuwa/config';
import {
  ApiException,
  AuthException,
  ConflictException,
  ConfigurationException,
  ServiceUnavailableException,
  TimeoutException,
} from '../../../src/lib/sikuwa/exceptions';
import { AbstractProvider } from '../../../src/lib/sikuwa/providers/abstract-provider';
import { Waxum } from '../../../src/lib/sikuwa/providers/waxum/waxum';
import { MockBackend } from '../mock-backend';

/**
 * Porting dari `tests/Providers/WaxumTest.php`, ditambah bagian yang tidak ada
 * di versi PHP (bentuk berkas base64/URL lain, presence, dan id sesi eksplisit).
 *
 * Waxum adalah satu-satunya gateway di SDK ini yang memakai
 * `Authorization: Bearer` dengan token terbitan servernya sendiri, dan
 * satu-satunya yang menolak `createSession()` untuk id yang sudah ada (HTTP
 * 409) — jadi alurnya `checkSession()` dulu. Dua hal khas Waxum yang dijaga di
 * sini: `qr_codes` adalah daftar yang isinya string mentah (bukan gambar), dan
 * amplop errornya bersarang di `error.message`.
 */

const BASE = 'https://waxum.test';
const SESSION = 'siku-1';
const API = '/api/v1';

/** Payload base64 yang isinya teks terbaca, supaya assertion-nya jelas. */
const TEXT_B64 = 'aGFsbyBkdW5pYQ==';

function fakeEnv(values: Record<string, string>): void {
  Config.useResolver((key) => values[key] ?? null);
}

function provider(backend: MockBackend, options: ConfigOptions = {}): Waxum {
  return new Waxum(
    { token: 'super-token', url: BASE, session: SESSION, ...options },
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

describe('Waxum — pengiriman teks', () => {
  test('satu pesan menuju messages/text dengan bearer token', async () => {
    const backend = new MockBackend([
      MockBackend.json({
        message_id: '3EB0WAX',
        timestamp: 1,
        to: '62811@s.whatsapp.net',
      }),
    ]);

    const result = await provider(backend).sendMessage({
      destination: '081234567890',
      message: 'halo',
    });

    expect(result).toBe('Sukses, messageId: 3EB0WAX');
    expect(backend.lastUrl()).toBe(`${BASE}${API}/sessions/${SESSION}/messages/text`);
    expect(backend.lastRequest()?.method).toBe('POST');
    expect(backend.lastJson()).toEqual({ to: '6281234567890', text: 'halo' });
  });

  /**
   * Waxum memakai `Authorization: Bearer` dengan token terbitan servernya
   * sendiri, jadi header-nya diperiksa terpisah dari body.
   */
  test('header autentikasi berupa Bearer', async () => {
    const backend = new MockBackend([MockBackend.json({ message_id: 'x' })]);

    await provider(backend, { token: 'abc' }).sendMessage({
      destination: '0811',
      message: 'a',
    });

    expect(backend.lastHeader('Authorization')).toBe('Bearer abc');
  });

  test('base URL yang sudah berakhiran /api/v1 tidak digandakan', async () => {
    const backend = new MockBackend([MockBackend.json({ message_id: 'x' })]);

    await provider(backend, { url: `${BASE}/api/v1` }).sendMessage({
      destination: '0811',
      message: 'a',
    });

    expect(backend.lastUrl()).toBe(`${BASE}${API}/sessions/${SESSION}/messages/text`);
  });

  test('JID diteruskan apa adanya, bukan dinormalkan', async () => {
    const backend = new MockBackend([MockBackend.json({ message_id: 'x' })]);

    await provider(backend).sendMessage({
      destination: '1234567890-123456@g.us',
      message: 'a',
    });

    // Menormalkan JID grup akan merusak identitasnya.
    expect(backend.lastJson()['to']).toBe('1234567890-123456@g.us');
  });

  test('beberapa pesan dikirim berurutan, bukan satu request', async () => {
    const backend = new MockBackend([
      MockBackend.json({ message_id: 'a' }),
      MockBackend.json({ message_id: 'b' }),
    ]);

    const result = await provider(backend).sendMessage([
      { destination: '0811', message: 'a' },
      { destination: '0822', message: 'b' },
    ]);

    expect(result).toBe('Sukses, 2/2 pesan terkirim');
    expect(backend.count()).toBe(2);
  });

  test('kegagalan satu pesan dikumpulkan, bukan menghentikan sisanya', async () => {
    const backend = new MockBackend([
      MockBackend.json({ message_id: 'a' }),
      MockBackend.json(
        { success: false, error: { code: 500, message: 'nomor tidak valid' } },
        500,
      ),
    ]);

    const error = await provider(backend)
      .sendMessage([
        { destination: '0811', message: 'a' },
        { destination: '0822', message: 'b' },
      ])
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiException);
    expect((error as ApiException).message).toContain('1/2 pesan terkirim');
    expect((error as ApiException).message).toContain('62822:');
  });

  test('sesi wajib diisi sebelum ada request', async () => {
    const backend = new MockBackend([]);

    await expect(
      provider(backend, { session: '' }).sendMessage({
        destination: '0811',
        message: 'a',
      }),
    ).rejects.toThrow('WHATSAPP_SESSION belum diisi di .env');

    expect(backend.count()).toBe(0);
  });
});

describe('Waxum — berkas', () => {
  test('gambar dikirim sebagai base64 dengan mimetype', async () => {
    const backend = new MockBackend([MockBackend.json({ message_id: 'IMG' })]);

    await provider(backend).sendImage({
      destination: '081234567890',
      image: `data:image/png;base64,${TEXT_B64}`,
      filename: 'bukti.png',
      caption: 'Bukti transfer',
    });

    expect(backend.lastUrl()).toBe(`${BASE}${API}/sessions/${SESSION}/messages/image`);
    expect(backend.lastJson()).toEqual({
      to: '6281234567890',
      // Data URI diubah ke {data, mimetype}: Waxum memisahkan keduanya.
      image: { data: TEXT_B64, mimetype: 'image/png' },
      caption: 'Bukti transfer',
    });
  });

  test('dokumen mempertahankan filename dan menuju endpoint document', async () => {
    const backend = new MockBackend([MockBackend.json({ message_id: 'DOC' })]);

    await provider(backend).sendFile({
      destination: '0811',
      file: TEXT_B64,
      filename: 'invoice-1209.pdf',
    });

    expect(backend.lastUrl()).toBe(
      `${BASE}${API}/sessions/${SESSION}/messages/document`,
    );
    expect(backend.lastJson()).toEqual({
      to: '62811',
      // Jenisnya ditebak dari ekstensi; Waxum menuntut mimetype ikut.
      document: { data: TEXT_B64, mimetype: 'application/pdf' },
      filename: 'invoice-1209.pdf',
    });
  });

  /**
   * Berbeda dari ApiMe dan wuzapi, Waxum mengunduh berkas dari URL sendiri —
   * jadi URL diteruskan sebagai `{url}`, bukan ditolak.
   */
  test('URL publik diteruskan sebagai objek url', async () => {
    const backend = new MockBackend([MockBackend.json({ message_id: 'URL' })]);

    await provider(backend).sendImage({
      destination: '0811',
      image: 'https://cdn.test/bukti.png',
      filename: 'bukti.png',
    });

    expect(backend.lastJson()).toEqual({
      to: '62811',
      image: { url: 'https://cdn.test/bukti.png' },
      // Endpoint gambar tidak menerima `filename`: nama itu hanya dipakai pada
      // dokumen, jadi kehadirannya di sini justru salah.
    });
  });

  test('berkas yang dikirim lewat sendFile tetap memakai endpoint image bila gambarnya', async () => {
    const backend = new MockBackend([MockBackend.json({ message_id: 'IMG' })]);

    await provider(backend).sendFile({
      destination: '0811',
      file: `data:image/png;base64,${TEXT_B64}`,
    });

    expect(backend.lastUrl()).toBe(`${BASE}${API}/sessions/${SESSION}/messages/image`);
  });

  // --- tambahan: jalur yang tidak dicakup PHP ---

  test('base64 telanjang mengambil mimetype dari ekstensi nama berkas', async () => {
    const backend = new MockBackend([MockBackend.json({ message_id: 'IMG' })]);

    await provider(backend).sendImage({
      destination: '0811',
      image: TEXT_B64,
      filename: 'bukti.png',
    });

    expect(backend.lastUrl()).toBe(`${BASE}${API}/sessions/${SESSION}/messages/image`);
    expect(backend.lastJson()).toEqual({
      to: '62811',
      image: { data: TEXT_B64, mimetype: 'image/png' },
    });
  });

  test('dokumen dari URL menuju endpoint document dan membawa filename', async () => {
    const backend = new MockBackend([MockBackend.json({ message_id: 'DOC' })]);

    await provider(backend).sendFile({
      destination: '0811',
      file: 'https://cdn.test/invoice.pdf',
      filename: 'invoice.pdf',
    });

    expect(backend.lastUrl()).toBe(
      `${BASE}${API}/sessions/${SESSION}/messages/document`,
    );
    expect(backend.lastJson()).toEqual({
      to: '62811',
      document: { url: 'https://cdn.test/invoice.pdf' },
      filename: 'invoice.pdf',
    });
  });

  test('caption kosong tidak ikut dikirim', async () => {
    const backend = new MockBackend([MockBackend.json({ message_id: 'IMG' })]);

    await provider(backend).sendImage({
      destination: '0811',
      image: `data:image/png;base64,${TEXT_B64}`,
    });

    expect(Object.keys(backend.lastJson())).toEqual(['to', 'image']);
  });
});

describe('Waxum — indikator ketik', () => {
  test('composing dikirim ke chatstate/send', async () => {
    const backend = new MockBackend([MockBackend.json({ message_id: 'x' })]);

    const result = await provider(backend).sendTyping({
      destination: '081234567890',
      duration: 3,
    });

    expect(result).toBe(
      'Sukses, indikator sedang mengetik dikirim ke 6281234567890',
    );
    expect(backend.lastUrl()).toBe(
      `${BASE}${API}/sessions/${SESSION}/chatstate/send`,
    );
    // Kosakata Waxum kebetulan sama dengan kosakata baku SDK ini.
    expect(backend.lastJson()).toEqual({
      to: '6281234567890',
      state: 'composing',
    });
  });

  test('keadaan recording diteruskan apa adanya', async () => {
    const backend = new MockBackend([MockBackend.json({ message_id: 'x' })]);

    await provider(backend).sendTyping({
      destination: '0811',
      state: 'audio',
      duration: 3,
    });

    expect(backend.lastJson()).toEqual({ to: '62811', state: 'recording' });
  });

  test('paused tidak memerlukan duration', async () => {
    const backend = new MockBackend([MockBackend.json({ message_id: 'x' })]);

    await provider(backend).sendTyping({ destination: '0811', state: 'paused' });

    expect(backend.lastJson()).toEqual({ to: '62811', state: 'paused' });
  });

  // --- tambahan ---

  test('hasil recording memakai label yang tepat', async () => {
    const backend = new MockBackend([MockBackend.json({ message_id: 'x' })]);

    const result = await provider(backend).sendTyping({
      destination: '0811',
      state: 'recording',
      duration: 3,
    });

    expect(result).toBe(
      'Sukses, indikator sedang merekam suara dikirim ke 62811',
    );
  });

  test('indikator ketik juga menuntut sesi', async () => {
    const backend = new MockBackend([]);

    await expect(
      provider(backend, { session: '' }).sendTyping({
        destination: '0811',
        duration: 3,
      }),
    ).rejects.toThrow('WHATSAPP_SESSION belum diisi di .env');

    expect(backend.count()).toBe(0);
  });
});

describe('Waxum — sesi', () => {
  test('createSession mengirim id dari options', async () => {
    const backend = new MockBackend([
      MockBackend.json({
        session: { id: 'notif', status: 'connecting', is_logged_in: false },
      }),
    ]);

    const session = await provider(backend).createSession({
      id: 'notif',
      name: 'Notifikasi',
    });

    expect(backend.lastUrl()).toBe(`${BASE}${API}/sessions`);
    expect(backend.lastJson()).toEqual({ id: 'notif', name: 'Notifikasi' });
    expect(session.provider).toBe('Waxum');
    expect(session.id).toBe('notif');
    expect(session.status).toBe('connecting');
    expect(session.isConnected()).toBe(false);
  });

  test('createSession jatuh ke id sesi terkonfigurasi', async () => {
    const backend = new MockBackend([
      MockBackend.json({ session: { id: SESSION, status: 'connecting' } }),
    ]);

    const session = await provider(backend).createSession();

    expect(backend.lastJson()).toEqual({ id: SESSION });
    expect(session.id).toBe(SESSION);
  });

  test('createSession meneruskan webhook dan device apa adanya', async () => {
    const backend = new MockBackend([
      MockBackend.json({ session: { id: 'notif', status: 'connecting' } }),
    ]);

    await provider(backend).createSession({
      id: 'notif',
      webhook: { url: 'https://app.test/hook' },
      device: { name: 'server-1' },
    });

    expect(backend.lastJson()).toEqual({
      id: 'notif',
      webhook: { url: 'https://app.test/hook' },
      device: { name: 'server-1' },
    });
  });

  test('checkSession membaca logged_in beserta nomor dan nama profil', async () => {
    const backend = new MockBackend([
      MockBackend.json({
        status: 'logged_in',
        is_logged_in: true,
        phone_number: '628123456789',
        push_name: 'SIKUWA',
      }),
    ]);

    const session = await provider(backend).checkSession();

    expect(backend.lastUrl()).toBe(`${BASE}${API}/sessions/${SESSION}/status`);
    expect(session.status).toBe('logged_in');
    expect(session.isConnected()).toBe(true);
    expect(session.phoneNumber).toBe('628123456789');
    expect(session.profileName).toBe('SIKUWA');
    expect(String(session)).toBe('Waxum: logged_in (siku-1)');
  });

  /**
   * Websocket yang hidup belum berarti login: hanya `is_logged_in` yang
   * menentukan sesi siap mengirim pesan.
   */
  test('connected tanpa login belum siap dipakai', async () => {
    const backend = new MockBackend([
      MockBackend.json({ status: 'connected', is_logged_in: false }),
    ]);

    const session = await provider(backend).checkSession();

    expect(session.status).toBe('connected');
    expect(session.isConnected()).toBe(false);
  });

  test('checkSession memakai id eksplisit bila diberikan', async () => {
    const backend = new MockBackend([
      MockBackend.json({ status: 'logged_in', is_logged_in: true }),
    ]);

    const session = await provider(backend).checkSession('sesi-lain');

    expect(backend.lastUrl()).toBe(`${BASE}${API}/sessions/sesi-lain/status`);
    expect(session.id).toBe('sesi-lain');
  });

  test('checkSession menolak sesi kosong', async () => {
    const backend = new MockBackend([]);

    await expect(provider(backend, { session: '' }).checkSession()).rejects.toThrow(
      ConfigurationException,
    );
  });
});

describe('Waxum — QR', () => {
  test('QR berupa data URI PNG lengkap diteruskan apa adanya', async () => {
    // Satu-satunya bentuk yang dianggap gambar oleh SDK, karena Waxum
    // mengirim string mentah untuk digambar sendiri.
    const dataUri = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';

    const backend = new MockBackend([
      MockBackend.json({
        qr_codes: [dataUri],
        timeout_seconds: 60,
        status: 'waiting_for_qr',
      }),
    ]);

    const qr = await provider(backend).showQr();

    expect(backend.lastUrl()).toBe(`${BASE}${API}/sessions/${SESSION}/qr`);
    expect(qr.hasQr()).toBe(true);
    expect(qr.qrImage()).toBe(dataUri);
    expect(qr.isConnected()).toBe(false);
  });

  /**
   * Waxum mengirim string mentah yang harus digambar sendiri oleh pemanggil.
   * Memasukkannya ke data URI PNG akan menghasilkan `<img>` yang rusak, jadi
   * SDK membiarkannya kosong dan bentuk mentahnya tetap ada di `raw`.
   */
  test('payload QR mentah tidak salah dilaporkan sebagai gambar', async () => {
    const backend = new MockBackend([
      MockBackend.json({ qr_codes: ['2@AbCdEf123456'], status: 'waiting_for_qr' }),
    ]);

    const qr = await provider(backend).showQr();

    expect(qr.hasQr()).toBe(false);
    expect(qr.qrTag()).toBe('');
    expect((qr.raw['qr_codes'] as string[])[0]).toBe('2@AbCdEf123456');
  });

  test('QR pada sesi yang sudah login bukan exception', async () => {
    const backend = new MockBackend([
      MockBackend.json({
        qr_codes: [],
        timeout_seconds: 60,
        status: 'logged_in',
      }),
    ]);

    const qr = await provider(backend).showQr();

    expect(qr.isConnected()).toBe(true);
    expect(qr.hasQr()).toBe(false);
    expect(qr.status).toBe('logged_in');
  });

  // --- tambahan ---

  test('base64 PNG telanjang (iVBOR) tetap dianggap gambar', async () => {
    const backend = new MockBackend([
      MockBackend.json({
        qr_codes: ['iVBORw0KGgoAAAANSUhEUg=='],
        status: 'waiting_for_qr',
      }),
    ]);

    const qr = await provider(backend).showQr();

    expect(qr.qrImage()).toBe('data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==');
  });

  test('sesi yang belum siap ditolak HTTP 503', async () => {
    const backend = new MockBackend([
      MockBackend.json(
        { success: false, error: { code: 503, message: 'Client not connected' } },
        503,
      ),
    ]);

    await expect(provider(backend).showQr()).rejects.toThrow(
      ServiceUnavailableException,
    );
  });
});

describe('Waxum — terjemahan kegagalan', () => {
  test('amplop error bersarang dibuka', async () => {
    const backend = new MockBackend([
      MockBackend.json(
        {
          success: false,
          error: { code: 404, message: 'Session not found: nope' },
        },
        404,
      ),
    ]);

    await expect(
      provider(backend).sendMessage({ destination: '0811', message: 'a' }),
    ).rejects.toThrow(
      'Waxum menolak pesan (HTTP 404): Session not found: nope [sesi tidak ditemukan, cek WHATSAPP_SESSION]',
    );
  });

  test('HTTP 401 menjelaskan soal token', async () => {
    const backend = new MockBackend([
      MockBackend.json(
        { success: false, error: { code: 401, message: 'Invalid token format' } },
        401,
      ),
    ]);

    const error = await provider(backend)
      .sendMessage({ destination: '0811', message: 'a' })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AuthException);
    expect((error as ApiException).message).toContain(
      '[token waxum salah atau kosong, cek WHATSAPP_TOKEN]',
    );
  });

  test('HTTP 503 menjelaskan bahwa tidak ada pesan yang terkirim', async () => {
    const backend = new MockBackend([
      MockBackend.json(
        { success: false, error: { code: 503, message: 'Client not connected' } },
        503,
      ),
    ]);

    const error = await provider(backend)
      .sendMessage({ destination: '0811', message: 'a' })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect((error as ApiException).message).toContain(
      '[sesi WhatsApp belum tersambung, tidak ada pesan yang terkirim — pindai QR-nya lewat showQr()]',
    );
  });

  test('HTTP 409 menjelaskan supaya memeriksa sesi dulu', async () => {
    const backend = new MockBackend([
      MockBackend.json(
        { success: false, error: { code: 409, message: 'Client already connected' } },
        409,
      ),
    ]);

    const error = await provider(backend)
      .createSession()
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ApiException).message).toContain(
      '[sesi dengan id itu sudah ada — pakai checkSession(), bukan createSession()]',
    );
  });

  test('timeout dilaporkan sebagai TimeoutException', async () => {
    const backend = new MockBackend([MockBackend.timeout()]);

    await expect(
      provider(backend).sendMessage({ destination: '0811', message: 'a' }),
    ).rejects.toThrow(TimeoutException);
  });

  test('respons 2xx yang bukan JSON tidak dilaporkan sebagai sukses', async () => {
    const backend = new MockBackend([MockBackend.raw()]);

    await expect(
      provider(backend).sendMessage({ destination: '0811', message: 'a' }),
    ).rejects.toThrow('Respons Waxum tidak valid (HTTP 200)');
  });
});

describe('Waxum — konfigurasi', () => {
  test('URL dan token diambil dari environment', async () => {
    fakeEnv({
      WHATSAPP_URL: 'https://env-waxum.test/',
      WHATSAPP_TOKEN: 'tok-env',
      WHATSAPP_SESSION: SESSION,
    });

    const backend = new MockBackend([MockBackend.json({ message_id: 'x' })]);

    await new Waxum(null, backend.executor()).sendMessage({
      destination: '0811',
      message: 'a',
    });

    expect(backend.lastUrl()).toBe(
      `https://env-waxum.test${API}/sessions/${SESSION}/messages/text`,
    );
    expect(backend.lastHeader('Authorization')).toBe('Bearer tok-env');
  });

  /** Kunci session per-provider menang atas `WHATSAPP_SESSION` bersama. */
  test('WHATSAPP_SESSION_Waxum menang atas WHATSAPP_SESSION bersama', async () => {
    fakeEnv({
      WHATSAPP_SESSION: 'sesi-bersama',
      WHATSAPP_SESSION_Waxum: 'sesi-waxum',
      WHATSAPP_TOKEN_Waxum: 'tok-env',
    });

    const backend = new MockBackend([MockBackend.json({ message_id: 'x' })]);

    await new Waxum(null, backend.executor()).sendMessage({
      destination: '0811',
      message: 'a',
    });

    expect(backend.lastUrl()).toBe(
      `https://waxum.whatsapp.com${API}/sessions/sesi-waxum/messages/text`,
    );
  });

  test('nama provider dan URL bawaannya', () => {
    expect(new Waxum({ token: 't' }).getProvider()).toBe('Waxum');
    expect(Waxum.DEFAULT_URL).toBe('https://waxum.whatsapp.com');
  });

  test('id sesi tidak di-encode di URL', async () => {
    const backend = new MockBackend([MockBackend.json({ message_id: 'x' })]);

    await provider(backend, { session: 'notif-sekolah' }).sendMessage({
      destination: '0811',
      message: 'a',
    });

    expect(backend.lastUrl()).toBe(
      `${BASE}${API}/sessions/notif-sekolah/messages/text`,
    );
  });

  test('getSessionId mengembalikan sesi terkonfigurasi', () => {
    expect(provider(new MockBackend([])).getSessionId()).toBe(SESSION);
  });
});
