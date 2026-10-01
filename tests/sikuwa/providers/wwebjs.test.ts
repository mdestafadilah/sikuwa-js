import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Config, type ConfigOptions } from '../../../src/lib/sikuwa/config';
import {
  ApiException,
  ConfigurationException,
  ForbiddenException,
  TimeoutException,
} from '../../../src/lib/sikuwa/exceptions';
import { AbstractProvider } from '../../../src/lib/sikuwa/providers/abstract-provider';
import { Wwebjs } from '../../../src/lib/sikuwa/providers/wwebjs/wwebjs';
import { MockBackend } from '../mock-backend';

/**
 * Porting dari `tests/Providers/WwebjsTest.php`, ditambah bagian yang tidak ada
 * di versi PHP (berkas dan indikator ketik).
 *
 * Wwebjs adalah gateway `sendIndividually` terbesar: satu endpoint pengiriman
 * untuk semua jenis pesan, endpoint presence yang berbeda per keadaan, dan QR
 * yang datang sebagai PNG biner. Dua hal yang dijaga di sini: tujuan wajib
 * berakhir `@c.us` (dan `@c.us` telanjang harus ditolak sebelum ada request),
 * serta konteks tambahan pada pesan error yang menjelaskan arti "Not Found".
 */

const BASE = 'https://wwebjs.test';
const SESSION = 'siku-1';

/**
 * Fixture PNG.
 *
 * Sengaja hanya berisi byte ASCII. `HttpExecutor` membaca body sebagai teks
 * UTF-8, sedangkan PNG asli memuat `0x89` di headernya — byte itu sudah menjadi
 * U+FFFD sebelum sampai ke provider, sehingga paritas byte mentah dengan PHP
 * mustahil di lapisan ini. Yang diuji di sini adalah pembungkusan menjadi data
 * URI, dan untuk byte yang selamat dari decode UTF-8 hasilnya sama persis
 * dengan `base64_encode()` milik PHP.
 */
const PNG = 'PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01';

function fakeEnv(values: Record<string, string>): void {
  Config.useResolver((key) => values[key] ?? null);
}

function provider(backend: MockBackend, options: ConfigOptions = {}): Wwebjs {
  return new Wwebjs(
    { token: 'api-key', url: BASE, session: SESSION, ...options },
    backend.executor(),
  );
}

function png(): Response {
  return new Response(PNG, { status: 200, headers: { 'Content-Type': 'image/png' } });
}

beforeEach(() => {
  Config.useResolver(() => null);
  AbstractProvider.useSleeper(null);
});

afterEach(() => {
  Config.useResolver(null);
  AbstractProvider.useSleeper(null);
});

describe('Wwebjs — pengiriman teks', () => {
  test('satu pesan dikirim ke client/sendMessage dengan header x-api-key', async () => {
    const backend = new MockBackend([
      MockBackend.json({
        success: true,
        message: { id: { _serialized: 'true_62811@c.us_3EB0' } },
      }),
    ]);

    const result = await provider(backend).sendMessage({
      destination: '081234567890',
      message: 'halo',
    });

    expect(result).toBe('Sukses, messageId: true_62811@c.us_3EB0');
    expect(backend.lastUrl()).toBe(`${BASE}/client/sendMessage/${SESSION}`);
    expect(backend.lastHeader('x-api-key')).toBe('api-key');
    expect(backend.lastJson()).toEqual({
      chatId: '6281234567890@c.us',
      contentType: 'string',
      content: 'halo',
    });
  });

  test('id pesan jatuh ke message.id.id bila _serialized tidak ada', async () => {
    const backend = new MockBackend([
      MockBackend.json({ success: true, message: { id: { id: 'FALLBACK' } } }),
    ]);

    const result = await provider(backend).sendMessage({ destination: '0811', message: 'a' });

    expect(result).toBe('Sukses, messageId: FALLBACK');
  });

  test('JID grup diteruskan apa adanya', async () => {
    const backend = new MockBackend([
      MockBackend.json({ success: true, message: { id: { id: 'x' } } }),
    ]);

    await provider(backend).sendMessage({
      destination: '1234567890-123456@g.us',
      message: 'a',
    });

    // Menormalkan JID grup akan merusak identitasnya — nomor di dalamnya
    // bukan nomor telepon yang bisa diberi awalan negara.
    expect(backend.lastJson()['chatId']).toBe('1234567890-123456@g.us');
  });

  test('tujuan tanpa nomor valid ditolak sebelum ada request', async () => {
    const backend = new MockBackend([]);

    await expect(
      provider(backend).sendMessage({ destination: 'abc', message: 'a' }),
    ).rejects.toThrow('tidak punya nomor tujuan yang valid');

    expect(backend.count()).toBe(0);
  });

  test('session yang belum diisi ditolak sebelum ada request', async () => {
    const backend = new MockBackend([]);

    await expect(
      provider(backend, { session: '' }).sendMessage({ destination: '0811', message: 'a' }),
    ).rejects.toThrow('WHATSAPP_SESSION belum diisi di .env');

    expect(backend.count()).toBe(0);
  });

  test('beberapa pesan dikirim satu per satu, bukan satu request', async () => {
    const backend = new MockBackend([
      MockBackend.json({ success: true, message: { id: { id: 'a' } } }),
      MockBackend.json({ success: true, message: { id: { id: 'b' } } }),
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
      MockBackend.json({ success: true, message: { id: { id: 'a' } } }),
      MockBackend.json({ success: false, error: 'Chat not Found' }, 404),
    ]);

    const error = await provider(backend)
      .sendMessage([
        { destination: '0811', message: 'a' },
        { destination: '0822', message: 'b' },
      ])
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiException);
    expect((error as ApiException).message).toContain('1/2 pesan terkirim');
    expect((error as ApiException).message).toContain('62822@c.us:');
  });
});

describe('Wwebjs — terjemahan kegagalan', () => {
  test('HTTP 404 menjelaskan session yang belum tersambung', async () => {
    const backend = new MockBackend([
      MockBackend.json({ success: false, error: 'session_not_connected' }, 404),
    ]);

    const error = await provider(backend)
      .sendMessage({ destination: '0811', message: 'a' })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiException);
    // "Not Found" tanpa konteks mudah disalahartikan sebagai endpoint salah.
    expect((error as ApiException).message).toContain(
      '[session belum tersambung, pindai QR-nya lebih dulu]',
    );
  });

  test('HTTP 403 menjelaskan API key', async () => {
    const backend = new MockBackend([
      MockBackend.json({ success: false, error: 'Invalid API key' }, 403),
    ]);

    const error = await provider(backend)
      .sendMessage({ destination: '0811', message: 'a' })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error as ApiException).message).toContain('[API key salah, cek WHATSAPP_TOKEN]');
  });

  test('respons 2xx yang bukan JSON tidak dilaporkan sebagai sukses', async () => {
    const backend = new MockBackend([MockBackend.raw()]);

    await expect(
      provider(backend).sendMessage({ destination: '0811', message: 'a' }),
    ).rejects.toThrow('Respons Wwebjs tidak valid (HTTP 200)');
  });

  test('timeout dilaporkan sebagai TimeoutException', async () => {
    const backend = new MockBackend([MockBackend.timeout()]);

    await expect(
      provider(backend).sendMessage({ destination: '0811', message: 'a' }),
    ).rejects.toThrow(TimeoutException);
  });
});

describe('Wwebjs — berkas', () => {
  test('gambar dikirim sebagai base64 mentah dengan caption', async () => {
    const backend = new MockBackend([
      MockBackend.json({ success: true, message: { id: { id: 'x' } } }),
    ]);

    await provider(backend).sendImage({
      destination: '081234567890',
      image: 'data:image/png;base64,' + btoa(PNG),
      filename: 'bukti.png',
      caption: 'Bukti transfer',
    });

    const payload = backend.lastJson();

    expect(payload['contentType']).toBe('MessageMedia');
    expect(payload['content']).toEqual({
      mimetype: 'image/png',
      // whatsapp-web.js menerima base64 mentah, bukan data URI.
      data: btoa(PNG),
      filename: 'bukti.png',
    });
    expect(payload['options']).toEqual({ caption: 'Bukti transfer' });
  });

  test('berkas tanpa caption tidak menyertakan options sama sekali', async () => {
    const backend = new MockBackend([
      MockBackend.json({ success: true, message: { id: { id: 'x' } } }),
    ]);

    await provider(backend).sendFile({
      destination: '0811',
      file: btoa('isi'),
      filename: 'laporan.pdf',
    });

    const payload = backend.lastJson();

    expect(payload['contentType']).toBe('MessageMedia');
    // whatsapp-web.js menimpa bawaannya dengan apa pun yang dikirim,
    // termasuk objek kosong — jadi `options` harus benar-benar absen.
    expect('options' in payload).toBe(false);
  });

  test('base64 telanjang memakai mimetype dari ekstensi nama berkas', async () => {
    const backend = new MockBackend([
      MockBackend.json({ success: true, message: { id: { id: 'x' } } }),
    ]);

    await provider(backend).sendFile({
      destination: '0811',
      file: btoa('isi'),
      filename: 'laporan.pdf',
    });

    expect(backend.lastJson()['content']).toEqual({
      mimetype: 'application/pdf',
      data: btoa('isi'),
      filename: 'laporan.pdf',
    });
  });

  test('URL publik dikirim sebagai MessageMediaFromURL', async () => {
    const backend = new MockBackend([
      MockBackend.json({ success: true, message: { id: { id: 'x' } } }),
    ]);

    await provider(backend).sendImage({
      destination: '0811',
      image: 'https://cdn.test/bukti.png',
      caption: 'Lihat ini',
    });

    const payload = backend.lastJson();

    expect(payload['contentType']).toBe('MessageMediaFromURL');
    expect(payload['content']).toBe('https://cdn.test/bukti.png');
    expect(payload['options']).toEqual({ caption: 'Lihat ini' });
  });

  test('URL publik tanpa caption juga tidak menyertakan options', async () => {
    const backend = new MockBackend([
      MockBackend.json({ success: true, message: { id: { id: 'x' } } }),
    ]);

    await provider(backend).sendImage({
      destination: '0811',
      image: 'https://cdn.test/bukti.png',
    });

    const payload = backend.lastJson();

    expect(payload['contentType']).toBe('MessageMediaFromURL');
    expect('options' in payload).toBe(false);
  });

  test('tujuan berkas tanpa nomor valid ditolak sebelum ada request', async () => {
    const backend = new MockBackend([]);

    await expect(
      provider(backend).sendImage({
        destination: 'abc',
        image: 'data:image/png;base64,' + btoa(PNG),
        filename: 'bukti.png',
      }),
    ).rejects.toThrow("Nomor tujuan 'abc' tidak valid");

    expect(backend.count()).toBe(0);
  });
});

describe('Wwebjs — indikator ketik', () => {
  test('composing memakai endpoint sendStateTyping', async () => {
    const backend = new MockBackend([MockBackend.json({ success: true, result: true })]);

    const result = await provider(backend).sendTyping({
      destination: '081234567890',
      state: 'composing',
      duration: 5,
    });

    expect(backend.lastUrl()).toBe(`${BASE}/chat/sendStateTyping/${SESSION}`);
    expect(backend.lastJson()).toEqual({ chatId: '6281234567890@c.us' });
    expect(result.startsWith('Sukses')).toBe(true);
  });

  test('recording memakai endpoint sendStateRecording', async () => {
    const backend = new MockBackend([MockBackend.json({ success: true, result: true })]);

    await provider(backend).sendTyping({
      destination: '081234567890',
      state: 'recording',
      duration: 3,
    });

    expect(backend.lastUrl()).toBe(`${BASE}/chat/sendStateRecording/${SESSION}`);
    expect(backend.lastJson()).toEqual({ chatId: '6281234567890@c.us' });
  });

  test('paused memakai endpoint clearState', async () => {
    const backend = new MockBackend([MockBackend.json({ success: true, result: true })]);

    await provider(backend).sendTyping({ destination: '0811', state: 'paused' });

    expect(backend.lastUrl()).toBe(`${BASE}/chat/clearState/${SESSION}`);
  });

  test('indikator ketik meneruskan JID grup apa adanya', async () => {
    const backend = new MockBackend([MockBackend.json({ success: true, result: true })]);

    await provider(backend).sendTyping({
      destination: '1234567890-123456@g.us',
      state: 'paused',
    });

    expect(backend.lastJson()).toEqual({ chatId: '1234567890-123456@g.us' });
  });

  test('indikator ketik menolak tujuan tanpa nomor valid', async () => {
    const backend = new MockBackend([]);

    await expect(
      provider(backend).sendTyping({ destination: 'abc', state: 'composing', duration: 5 }),
    ).rejects.toThrow("Nomor tujuan 'abc' tidak valid");

    expect(backend.count()).toBe(0);
  });
});

describe('Wwebjs — QR dan session', () => {
  test('showQr membungkus PNG menjadi data URI', async () => {
    const backend = new MockBackend([png()]);

    const session = await provider(backend).showQr();

    expect(session.qrImage()).toBe('data:image/png;base64,' + btoa(PNG));
    expect(session.hasQr()).toBe(true);
    expect(session.isConnected()).toBe(false);
    expect(backend.lastUrl()).toBe(`${BASE}/session/qr/${SESSION}/image`);
  });

  test('showQr yang sudah dipindai dilaporkan sebagai tersambung', async () => {
    const backend = new MockBackend([
      MockBackend.json({ success: false, message: 'qr code not ready or already scanned' }),
      MockBackend.json({ success: true, state: 'CONNECTED', message: 'session_connected' }),
    ]);

    const session = await provider(backend).showQr();

    expect(session.isConnected()).toBe(true);
    expect(session.hasQr()).toBe(false);
    // Satu request QR, satu request status — statusnya hanya ditanyakan di
    // jalur "sudah dipindai", bukan untuk setiap QR.
    expect(backend.count()).toBe(2);
  });

  test('showQr saat QR belum siap tetap ditolak', async () => {
    const backend = new MockBackend([
      MockBackend.json({ success: false, message: 'qr code not ready or already scanned' }),
      MockBackend.json({ success: false, state: null, message: 'session_not_connected' }),
    ]);

    await expect(provider(backend).showQr()).rejects.toThrow(
      'Wwebjs menolak pesan (HTTP 200): qr code not ready or already scanned',
    );
  });

  test('checkSession memetakan state CONNECTED, dan message saat state kosong', async () => {
    const backend = new MockBackend([
      MockBackend.json({ success: true, state: 'CONNECTED', message: 'session_connected' }),
      MockBackend.json({ success: false, state: null, message: 'session_not_found' }),
    ]);

    const api = provider(backend);

    const connected = await api.checkSession();
    expect(connected.isConnected()).toBe(true);
    expect(connected.status).toBe('CONNECTED');
    expect(connected.id).toBe(SESSION);

    // `state` kosong, jadi `message` yang menjelaskan sebabnya.
    const missing = await api.checkSession();
    expect(missing.isConnected()).toBe(false);
    expect(missing.status).toBe('session_not_found');
  });

  test('checkSession memakai id eksplisit bila diberikan', async () => {
    const backend = new MockBackend([
      MockBackend.json({ success: true, state: 'CONNECTED', message: 'session_connected' }),
    ]);

    await provider(backend).checkSession('lain');

    expect(backend.lastUrl()).toBe(`${BASE}/session/status/lain`);
  });

  test('createSession mengirim webhookUrl dan memakai nama terkonfigurasi', async () => {
    const backend = new MockBackend([
      MockBackend.json({ success: true, message: 'Session initiated successfully' }),
    ]);

    const session = await provider(backend).createSession({
      webhookUrl: 'https://hook.test/wa',
    });

    expect(backend.lastUrl()).toBe(`${BASE}/session/start/${SESSION}`);
    expect(backend.lastJson()).toEqual({ webhookUrl: 'https://hook.test/wa' });
    expect(session.id).toBe(SESSION);
    expect(session.isConnected()).toBe(false);
  });

  test('createSession tanpa webhook mengirim body kosong', async () => {
    const backend = new MockBackend([MockBackend.json({ success: true, message: 'ok' })]);

    await provider(backend).createSession({ id: 'siku-2' });

    expect(backend.lastUrl()).toBe(`${BASE}/session/start/siku-2`);
    expect(backend.lastBody()).toBe('');
  });

  test('createSession menerima alias name untuk nama session', async () => {
    const backend = new MockBackend([MockBackend.json({ success: true, message: 'ok' })]);

    await provider(backend).createSession({ name: 'siku-3' });

    expect(backend.lastUrl()).toBe(`${BASE}/session/start/siku-3`);
  });

  test('createSession menolak nama di luar [A-Za-z0-9_-] lebih awal', async () => {
    const backend = new MockBackend([]);

    await expect(provider(backend).createSession({ id: 'siku satu' })).rejects.toThrow(
      'Nama session Wwebjs hanya boleh huruf, angka, garis bawah, dan tanda minus',
    );

    expect(backend.count()).toBe(0);
  });

  test('createSession tanpa nama sama sekali ditolak', async () => {
    const backend = new MockBackend([]);

    await expect(provider(backend, { session: '' }).createSession()).rejects.toThrow(
      ConfigurationException,
    );
    expect(backend.count()).toBe(0);
  });
});

describe('Wwebjs — konfigurasi', () => {
  test('URL dan token dibaca dari environment', async () => {
    fakeEnv({
      WHATSAPP_URL: 'https://env-wwebjs.test/',
      WHATSAPP_TOKEN: 'tok-env',
      WHATSAPP_SESSION: 'env-session',
    });

    const backend = new MockBackend([
      MockBackend.json({ success: true, message: { id: { id: 'a' } } }),
    ]);

    await new Wwebjs(null, backend.executor()).sendMessage({
      destination: '0811',
      message: 'a',
    });

    expect(backend.lastUrl()).toBe('https://env-wwebjs.test/client/sendMessage/env-session');
    expect(backend.lastHeader('x-api-key')).toBe('tok-env');
  });

  test('WHATSAPP_SESSION_Wwebjs menang atas WHATSAPP_SESSION bersama', async () => {
    fakeEnv({
      WHATSAPP_SESSION: 'sesi-bersama',
      WHATSAPP_SESSION_Wwebjs: 'sesi-wwebjs',
      WHATSAPP_TOKEN_Wwebjs: 'tok-env',
    });

    const backend = new MockBackend([
      MockBackend.json({ success: true, message: { id: { id: 'a' } } }),
    ]);

    await new Wwebjs(null, backend.executor()).sendMessage({
      destination: '0811',
      message: 'a',
    });

    // Supaya session wwebjs tidak bertabrakan dengan gateway lain yang
    // dikonfigurasi bersamaan.
    expect(backend.lastUrl()).toContain('/client/sendMessage/sesi-wwebjs');
  });
});
