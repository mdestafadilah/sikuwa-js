import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Config, type ConfigOptions } from '../../../src/lib/sikuwa/config';
import {
  ApiException,
  AuthException,
  TimeoutException,
} from '../../../src/lib/sikuwa/exceptions';
import { AbstractProvider } from '../../../src/lib/sikuwa/providers/abstract-provider';
import { Wuzapi } from '../../../src/lib/sikuwa/providers/wuzapi/wuzapi';
import { WuzapiMessage } from '../../../src/lib/sikuwa/providers/wuzapi/wuzapi-message';
import { MockBackend } from '../mock-backend';

/**
 * Porting dari `tests/Providers/WuzapiTest.php`, ditambah bagian yang tidak ada
 * di versi PHP (berkas, presence, dan sesi).
 *
 * wuzapi adalah gateway `sendIndividually` dengan satu kebiasaan yang harus
 * dijaga betul: ia membalas **HTTP 200 hampir di semua jalur**, termasuk saat
 * gagal. Yang menentukan berhasil atau tidak adalah penanda `success` di dalam
 * amplop body, bukan status HTTP-nya. Karena itu test di sini memeriksa pesan
 * error yang berasal dari amplop, bukan dari status.
 *
 * Dua hal khas wuzapi yang juga dijaga: berkas hanya boleh dikirim sebagai
 * data URI (URL publik ditolak, base64 telanjang dibungkus lebih dulu), dan
 * merekam suara ditandai lewat kolom `Media`, bukan lewat keadaan tersendiri.
 */

const BASE = 'https://v4.test';

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

function provider(backend: MockBackend, options: ConfigOptions = {}): Wuzapi {
  return new Wuzapi(
    { token: 'user-token', url: BASE, ...options },
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

describe('Wuzapi — pengiriman teks', () => {
  test('satu pesan menuju chat/send/text dengan payload PascalCase', async () => {
    const backend = new MockBackend([
      MockBackend.json({ success: true, data: { Id: '3EB0WUZ' } }),
    ]);

    const result = await provider(backend).sendMessage({
      destination: '081234567890',
      message: 'halo',
    });

    expect(result).toBe('Sukses, messageId: 3EB0WUZ');
    expect(backend.lastUrl()).toBe(`${BASE}/chat/send/text`);
    expect(backend.methodAt(0)).toBe('POST');
    expect(backend.lastHeader('Token')).toBe('user-token');
    expect(backend.lastJson()).toEqual({ Phone: '6281234567890', Body: 'halo' });
  });

  test('JID grup diteruskan apa adanya', async () => {
    const backend = new MockBackend([
      MockBackend.json({ success: true, data: { Id: 'a' } }),
    ]);

    await provider(backend).sendMessage({
      destination: '1234567890-123456@g.us',
      message: 'a',
    });

    // Angka di dalam JID grup bukan nomor telepon; menormalkannya akan
    // merusak identitas grup.
    expect(backend.lastJson()['Phone']).toBe('1234567890-123456@g.us');
  });

  test('nomor tujuan yang tidak bisa dibaca ditolak sebelum request', async () => {
    const backend = new MockBackend([]);

    await expect(
      provider(backend).sendMessage({ destination: 'abc', message: 'a' }),
    ).rejects.toThrow('tidak punya nomor tujuan yang valid');

    expect(backend.count()).toBe(0);
  });

  test('beberapa pesan dikirim satu per satu, bukan satu request', async () => {
    const backend = new MockBackend([
      MockBackend.json({ success: true, data: { Id: 'a' } }),
      MockBackend.json({ success: true, data: { Id: 'b' } }),
    ]);

    const result = await provider(backend).sendMessage([
      { destination: '0811', message: 'a' },
      { destination: '0822', message: 'b' },
    ]);

    expect(result).toBe('Sukses, 2/2 pesan terkirim');
    expect(backend.count()).toBe(2);
  });

  test('kegagalan satu pesan tidak membatalkan sisanya, tapi tetap dilaporkan', async () => {
    const backend = new MockBackend([
      MockBackend.json({ success: true, data: { Id: 'a' } }),
      MockBackend.json({ code: 500, error: 'nomor tidak valid', success: false }),
    ]);

    const error = await capture(() =>
      provider(backend).sendMessage([
        { destination: '0811', message: 'a' },
        { destination: '0822', message: 'b' },
      ]),
    );

    expect(error).toBeInstanceOf(ApiException);
    expect((error as ApiException).message).toContain('1/2 pesan terkirim');
    // Penandanya nomor yang sudah dinormalkan, bukan yang mentah.
    expect((error as ApiException).message).toContain('62822:');
  });
});

describe('Wuzapi — terjemahan kegagalan', () => {
  /**
   * wuzapi membalas HTTP 200 hampir di semua jalur, jadi penanda `success`
   * di amplop body yang harus dipercaya — bukan status HTTP-nya.
   */
  test('success:false diperlakukan sebagai kegagalan', async () => {
    const backend = new MockBackend([
      MockBackend.json({ code: 500, error: 'gagal mengirim', success: false }),
    ]);

    await expect(
      provider(backend).sendMessage({ destination: '0811', message: 'a' }),
    ).rejects.toThrow('Wuzapi menolak pesan (HTTP 500): gagal mengirim');
  });

  test('HTTP 401 menjelaskan soal token', async () => {
    const backend = new MockBackend([
      MockBackend.json({ code: 401, error: 'unauthorized', success: false }),
    ]);

    const error = await capture(() =>
      provider(backend).sendMessage({ destination: '0811', message: 'a' }),
    );

    expect(error).toBeInstanceOf(AuthException);
    expect((error as ApiException).message).toContain('[token salah, cek WHATSAPP_TOKEN]');
  });

  test('"no session" menjelaskan bahwa QR perlu dipindai', async () => {
    const backend = new MockBackend([
      MockBackend.json({ code: 500, error: 'no session found', success: false }),
    ]);

    const error = await capture(() =>
      provider(backend).sendMessage({ destination: '0811', message: 'a' }),
    );

    expect(error).toBeInstanceOf(ApiException);
    expect((error as ApiException).message).toContain(
      '[sesi WhatsApp belum tersambung, scan QR di /login]',
    );
  });

  test('status HTTP non-2xx ditolak lewat amplopnya', async () => {
    const backend = new MockBackend([MockBackend.json({ error: 'boom' }, 502)]);

    await expect(
      provider(backend).sendMessage({ destination: '0811', message: 'a' }),
    ).rejects.toThrow('Wuzapi menolak pesan (HTTP 502): boom');
  });

  test('body 2xx yang bukan JSON tidak dilaporkan sebagai sukses', async () => {
    const backend = new MockBackend([MockBackend.raw()]);

    await expect(
      provider(backend).sendMessage({ destination: '0811', message: 'a' }),
    ).rejects.toThrow('Respons Wuzapi tidak valid (HTTP 200)');
  });

  test('timeout dilaporkan sebagai TimeoutException', async () => {
    const backend = new MockBackend([MockBackend.timeout()]);

    await expect(
      provider(backend).sendMessage({ destination: '0811', message: 'a' }),
    ).rejects.toThrow(TimeoutException);
  });
});

describe('Wuzapi — berkas', () => {
  test('gambar dikirim sebagai data URI ke chat/send/image', async () => {
    const backend = new MockBackend([
      MockBackend.json({ success: true, data: { Id: 'img-1' } }),
    ]);

    const result = await provider(backend).sendImage({
      destination: '081234567890',
      image: 'data:image/png;base64,QUJD',
      filename: 'foto.png',
      caption: 'lihat ini',
    });

    expect(result).toBe('Sukses, messageId: img-1');
    expect(backend.lastUrl()).toBe(`${BASE}/chat/send/image`);
    expect(backend.lastJson()).toEqual({
      Phone: '6281234567890',
      Image: 'data:image/png;base64,QUJD',
      Caption: 'lihat ini',
    });
  });

  test('base64 telanjang dibungkus menjadi data URI', async () => {
    const backend = new MockBackend([
      MockBackend.json({ success: true, data: { Id: 'img-2' } }),
    ]);

    await provider(backend).sendImage({
      destination: '0811',
      image: 'QUJD',
      filename: 'foto.png',
    });

    // wuzapi tidak menerima base64 telanjang; `File.dataUri()` yang
    // membungkusnya, dan jenisnya diambil dari ekstensi nama berkas.
    expect(backend.lastJson()['Image']).toBe('data:image/png;base64,QUJD');
  });

  test('URL publik ditolak dengan penjelasan, bukan kegagalan unduh', async () => {
    const backend = new MockBackend([]);

    // wuzapi tidak mengunduh apa pun sendiri — ia hanya menerima isinya.
    await expect(
      provider(backend).sendImage({
        destination: '0811',
        image: 'https://contoh.test/foto.png',
        filename: 'foto.png',
      }),
    ).rejects.toThrow('wuzapi hanya menerima isi berkas sebagai data URI, bukan URL');

    expect(backend.count()).toBe(0);
  });

  test('dokumen selalu dikirim sebagai octet-stream', async () => {
    const backend = new MockBackend([
      MockBackend.json({ success: true, data: { Id: 'doc-1' } }),
    ]);

    await provider(backend).sendFile({
      destination: '081234567890',
      file: 'data:application/pdf;base64,QUJD',
      filename: 'laporan.pdf',
    });

    expect(backend.lastUrl()).toBe(`${BASE}/chat/send/document`);
    // Jenis aslinya (application/pdf) sengaja dibuang: dokumentasi wuzapi
    // meminta dokumen apa pun dikirim sebagai octet-stream.
    expect(backend.lastJson()).toEqual({
      Phone: '6281234567890',
      FileName: 'laporan.pdf',
      Document: 'data:application/octet-stream;base64,QUJD',
    });
  });
});

describe('Wuzapi — indikator ketik', () => {
  test('composing dikirim sebagai State composing tanpa Media', async () => {
    const backend = new MockBackend([MockBackend.json({ success: true })]);

    const result = await provider(backend).sendTyping({
      destination: '081234567890',
      state: 'composing',
      duration: 5,
    });

    expect(backend.lastUrl()).toBe(`${BASE}/chat/presence`);
    expect(backend.lastJson()).toEqual({
      Phone: '6281234567890',
      State: 'composing',
      Media: '',
    });
    expect(result).toContain('indikator');
  });

  test('paused menjadi State paused', async () => {
    const backend = new MockBackend([MockBackend.json({ success: true })]);

    await provider(backend).sendTyping({ destination: '0811', state: 'paused' });

    expect(backend.lastJson()).toEqual({ Phone: '62811', State: 'paused', Media: '' });
  });

  test('recording ditandai lewat Media audio, bukan keadaan tersendiri', async () => {
    const backend = new MockBackend([MockBackend.json({ success: true })]);

    // wuzapi tidak mengenal keadaan "recording": merekam suara adalah
    // `composing` dengan `Media: 'audio'`. Menerjemahkannya di tempat lain
    // akan mengirim keadaan yang tidak dikenal gateway.
    const result = await provider(backend).sendTyping({
      destination: '0811',
      state: 'recording',
      duration: 5,
    });

    expect(backend.lastJson()).toEqual({ Phone: '62811', State: 'composing', Media: 'audio' });
    expect(result).toContain('sedang merekam suara');
  });

  test('presence yang gagal tetap dilempar', async () => {
    const backend = new MockBackend([
      MockBackend.json({ code: 500, error: 'no session found', success: false }),
    ]);

    const error = await capture(() =>
      provider(backend).sendTyping({ destination: '0811', state: 'composing', duration: 5 }),
    );

    expect(error).toBeInstanceOf(ApiException);
    expect((error as ApiException).message).toContain('no session found');
  });
});

describe('Wuzapi — sesi', () => {
  test('createSession mengirim Subscribe bawaan dan Immediate', async () => {
    const backend = new MockBackend([
      MockBackend.json({ success: true, data: { jid: '62811:1@s.whatsapp.net' } }),
    ]);

    const session = await provider(backend).createSession();

    expect(backend.lastUrl()).toBe(`${BASE}/session/connect`);
    expect(backend.lastJson()).toEqual({ Subscribe: ['Message'], Immediate: true });
    expect(session.id).toBe('62811:1@s.whatsapp.net');
    expect(session.status).toBe('connected');
    expect(session.isConnected()).toBe(true);
  });

  test('createSession menghormati subscribe dan immediate pemanggil', async () => {
    const backend = new MockBackend([
      MockBackend.json({ success: true, data: { jid: 'x' } }),
    ]);

    await provider(backend).createSession({
      subscribe: ['Message', 'ReadReceipt'],
      immediate: false,
    });

    expect(backend.lastJson()).toEqual({
      Subscribe: ['Message', 'ReadReceipt'],
      Immediate: false,
    });
  });

  test('checkSession membedakan connected dari connecting', async () => {
    const backend = new MockBackend([
      MockBackend.json({ success: true, data: { Connected: true, LoggedIn: false } }),
      MockBackend.json({ success: true, data: { Connected: true, LoggedIn: true } }),
      MockBackend.json({ success: true, data: { Connected: false } }),
    ]);

    const api = provider(backend);

    // Websocket sudah terbentuk tetapi QR belum dipindai: belum bisa kirim.
    const connecting = await api.checkSession();
    expect(connecting.status).toBe('connecting');
    expect(connecting.isConnected()).toBe(false);

    const connected = await api.checkSession();
    expect(connected.status).toBe('connected');
    expect(connected.isConnected()).toBe(true);

    const disconnected = await api.checkSession();
    expect(disconnected.status).toBe('disconnected');
  });

  test('showQr membaca QRCode sebagai data URI', async () => {
    const backend = new MockBackend([
      MockBackend.json({ success: true, data: { QRCode: 'data:image/png;base64,QUJD' } }),
    ]);

    const session = await provider(backend).showQr();

    expect(backend.lastUrl()).toBe(`${BASE}/session/qr`);
    expect(session.status).toBe('qr_ready');
    expect(session.qr).toBe('data:image/png;base64,QUJD');
    expect(session.hasQr()).toBe(true);
    expect(session.isConnected()).toBe(false);
  });

  test('showQr membaca QRCode yang ada di akar body', async () => {
    const backend = new MockBackend([
      MockBackend.json({ success: true, QRCode: 'data:image/png;base64,QUJD' }),
    ]);

    const session = await provider(backend).showQr();

    expect(session.qr).toBe('data:image/png;base64,QUJD');
  });

  test('"already logged in" dilaporkan sebagai connected, bukan kegagalan', async () => {
    const backend = new MockBackend([
      MockBackend.json({ error: 'already logged in', success: false }, 400),
    ]);

    // wuzapi melaporkan keadaan ini sebagai HTTP error, padahal bagi pemanggil
    // itu keadaan akhir yang sah: tidak ada lagi QR yang perlu dipindai.
    const session = await provider(backend).showQr();

    expect(session.status).toBe('connected');
    expect(session.isConnected()).toBe(true);
  });

  test('"no session" pada showQr tetap dilempar', async () => {
    const backend = new MockBackend([
      MockBackend.json({ error: 'no session found', success: false }, 400),
    ]);

    const error = await capture(() => provider(backend).showQr());

    expect(error).toBeInstanceOf(ApiException);
    expect((error as ApiException).message).toContain('no session found');
  });
});

describe('Wuzapi — konfigurasi', () => {
  test('URL dan token dibaca dari environment', async () => {
    fakeEnv({
      WHATSAPP_URL: 'https://env-wuzapi.test/',
      WHATSAPP_TOKEN: 'tok-env',
    });

    const backend = new MockBackend([
      MockBackend.json({ success: true, data: { Id: 'a' } }),
    ]);

    await new Wuzapi(null, backend.executor()).sendMessage({
      destination: '0811',
      message: 'a',
    });

    // `rtrim($url, '/')` PHP membuang SEMUA garis miring di ujung.
    expect(backend.lastUrl()).toBe('https://env-wuzapi.test/chat/send/text');
    expect(backend.lastHeader('Token')).toBe('tok-env');
  });

  test('WHATSAPP_URL_Wuzapi menang atas WHATSAPP_URL bersama', async () => {
    fakeEnv({
      WHATSAPP_URL: 'https://bersama.test',
      WHATSAPP_URL_Wuzapi: 'https://wuzapi.test',
      WHATSAPP_TOKEN_Wuzapi: 'tok-env',
    });

    const backend = new MockBackend([
      MockBackend.json({ success: true, data: { Id: 'a' } }),
    ]);

    await new Wuzapi(null, backend.executor()).sendMessage({
      destination: '0811',
      message: 'a',
    });

    expect(backend.lastUrl()).toBe('https://wuzapi.test/chat/send/text');
  });

  test('DEFAULT_URL disalin apa adanya dari PHP', () => {
    // Disengaja tidak diubah: mengubahnya membuat kedua paket berbeda
    // perilaku tanpa alasan, walau URL bawaannya tidak pernah terpakai.
    expect(Wuzapi.DEFAULT_URL).toBe('https://wuzapi.whatsapp.com');
    expect(Wuzapi.NAME).toBe('Wuzapi');
  });
});

describe('Wuzapi — DTO', () => {
  test('nomor polos dinormalkan, JID dibiarkan', () => {
    expect(new WuzapiMessage('081234567890', 'a').phone).toBe('6281234567890');
    expect(new WuzapiMessage('123-456@g.us', 'a').phone).toBe('123-456@g.us');
  });

  test('toArray memakai kunci PascalCase', () => {
    expect(new WuzapiMessage('0811', 'halo').toArray()).toEqual({
      Phone: '62811',
      Body: 'halo',
    });
  });
});
