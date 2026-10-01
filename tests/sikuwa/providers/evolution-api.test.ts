import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Config, type ConfigOptions } from '../../../src/lib/sikuwa/config';
import {
  ApiException,
  AuthException,
  ConfigurationException,
  ForbiddenException,
  NotFoundException,
} from '../../../src/lib/sikuwa/exceptions';
import { AbstractProvider } from '../../../src/lib/sikuwa/providers/abstract-provider';
import { EvolutionAPI } from '../../../src/lib/sikuwa/providers/evolution-api/evolution-api';
import { MockBackend } from '../mock-backend';

/**
 * Porting dari `tests/Providers/EvolutionAPITest.php`, ditambah bagian yang
 * tidak ada di versi PHP (berkas, presence, dan sesi/instance).
 *
 * Dua hal khas Evolution API yang dijaga di sini:
 *
 * - `delay` ditulis pemanggil dalam DETIK seperti gateway lain, lalu dikonversi
 *   ke MILIDETIK di dalam payload — Evolution yang menghitungnya begitu;
 * - `presenceBlocks()` bernilai true, sebab satu request presence Evolution
 *   sudah berisi composing, jeda, dan paused sekaligus. Kalau SDK ikut
 *   menidurkan dirinya, pemanggil menunggu dua kali.
 */

const BASE = 'https://v7.test';
const INSTANCE = 'siku';

function fakeEnv(values: Record<string, string>): void {
  Config.useResolver((key) => values[key] ?? null);
}

function provider(backend: MockBackend, options: ConfigOptions = {}): EvolutionAPI {
  return new EvolutionAPI(
    { token: 'api-key', url: BASE, instance: INSTANCE, ...options },
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

describe('EvolutionAPI — pengiriman teks', () => {
  test('satu pesan menuju message/sendText', async () => {
    const backend = new MockBackend([MockBackend.json({ key: { id: '3EB0XYZ' } })]);

    const result = await provider(backend).sendMessage({
      destination: '081234567890',
      message: 'halo',
    });

    expect(result).toBe('Sukses, messageId: 3EB0XYZ');
    expect(backend.lastUrl()).toBe(`${BASE}/message/sendText/${INSTANCE}`);
    expect(backend.lastHeader('apikey')).toBe('api-key');
    expect(backend.lastJson()).toEqual({ number: '6281234567890', text: 'halo' });
  });

  test('JID grup diteruskan apa adanya', async () => {
    const backend = new MockBackend([MockBackend.json({ key: { id: 'a' } })]);

    await provider(backend).sendMessage({
      destination: '1234567890-123456@g.us',
      message: 'a',
    });

    // Menormalkan JID grup akan merusak identitasnya — nomor di dalamnya bukan
    // nomor telepon yang bisa diberi awalan negara.
    expect(backend.lastJson()['number']).toBe('1234567890-123456@g.us');
  });

  test('delay detik dikonversi ke milidetik', async () => {
    const backend = new MockBackend([MockBackend.json({ key: { id: 'x' } })]);

    await provider(backend).sendMessage({
      destination: '0811',
      message: 'a',
      delay: 4,
    });

    // Antarmuka SDK memakai detik; Evolution menghitung milidetik.
    expect(backend.lastJson()['delay']).toBe(4000);
  });

  test('delay nol tidak ikut dikirim', async () => {
    const backend = new MockBackend([MockBackend.json({ key: { id: 'x' } })]);

    await provider(backend).sendMessage({ destination: '0811', message: 'a' });

    expect(backend.lastJson()).not.toHaveProperty('delay');
  });

  test('instance yang belum diisi ditolak sebelum ada request', async () => {
    const backend = new MockBackend([]);

    await expect(
      provider(backend, { instance: '' }).sendMessage({
        destination: '0811',
        message: 'a',
      }),
    ).rejects.toThrow('WHATSAPP_INSTANCE belum diisi di .env');

    expect(backend.count()).toBe(0);
  });

  test('beberapa pesan dikirim satu per satu tanpa memblokir pemanggil', async () => {
    const backend = new MockBackend([
      MockBackend.json({ key: { id: 'a' } }),
      MockBackend.json({ key: { id: 'b' } }),
    ]);

    const mulai = Date.now();

    const result = await provider(backend).sendMessage([
      { destination: '0811', message: 'a', delay: 5 },
      { destination: '0822', message: 'b', delay: 5 },
    ]);

    expect(result).toBe('Sukses, 2/2 pesan terkirim');
    expect(backend.count()).toBe(2);
    // Jeda dititipkan ke server lewat payload, jadi klien tidak menunggu di
    // antara request — dua pesan harus terkirim hampir seketika.
    expect(Date.now() - mulai).toBeLessThan(1000);
  });
});

describe('EvolutionAPI — terjemahan kegagalan', () => {
  test('HTTP 401 menjelaskan apikey yang salah', async () => {
    const backend = new MockBackend([MockBackend.json({ error: 'Unauthorized' }, 401)]);

    const error = await provider(backend)
      .sendMessage({ destination: '0811', message: 'a' })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AuthException);
    expect((error as ApiException).message).toContain('[apikey salah, cek WHATSAPP_TOKEN]');
  });

  test('HTTP 403 menjelaskan instance yang belum tersambung', async () => {
    const backend = new MockBackend([MockBackend.json({ error: 'Forbidden' }, 403)]);

    const error = await provider(backend)
      .sendMessage({ destination: '0811', message: 'a' })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error as ApiException).message).toContain(
      '[instance belum tersambung ke WhatsApp]',
    );
  });

  test('HTTP 404 menjelaskan nama instance', async () => {
    const backend = new MockBackend([MockBackend.json({ error: 'Not Found' }, 404)]);

    const error = await provider(backend)
      .sendMessage({ destination: '0811', message: 'a' })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(NotFoundException);
    expect((error as ApiException).message).toContain(
      '[instance tidak ditemukan, cek WHATSAPP_INSTANCE]',
    );
  });

  test('detail error bersarang di response.message dipakai', async () => {
    const backend = new MockBackend([
      MockBackend.json(
        {
          status: 400,
          error: 'Bad Request',
          response: { message: ['number is required'] },
        },
        400,
      ),
    ]);

    const error = await provider(backend)
      .sendMessage({ destination: '0811', message: 'a' })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiException);
    // Evolution menyelipkan detail aslinya di response.message, bukan di
    // message tingkat atas.
    expect((error as ApiException).message).toContain(
      'EvolutionAPI menolak pesan (HTTP 400): number is required',
    );
  });

  test('respons 2xx yang bukan JSON tidak dilaporkan sebagai sukses', async () => {
    const backend = new MockBackend([MockBackend.raw()]);

    await expect(
      provider(backend).sendMessage({ destination: '0811', message: 'a' }),
    ).rejects.toThrow('Respons EvolutionAPI tidak valid (HTTP 200)');
  });
});

describe('EvolutionAPI — berkas', () => {
  test('gambar dikirim sebagai base64 telanjang, bukan data URI', async () => {
    const backend = new MockBackend([MockBackend.json({ key: { id: 'img-1' } })]);

    const result = await provider(backend).sendImage({
      destination: '081234567890',
      image: 'data:image/png;base64,QUJD',
      filename: 'foto.png',
      caption: 'lihat',
    });

    expect(result).toBe('Sukses, messageId: img-1');
    expect(backend.lastUrl()).toBe(`${BASE}/message/sendMedia/${INSTANCE}`);
    // Evolution memakai `isBase64()` class-validator yang tidak mengenali
    // awalan `data:…;base64,` — jadi isinya harus base64 telanjang. Gambar
    // tidak memakai `fileName`, hanya `mimetype`.
    expect(backend.lastJson()).toEqual({
      number: '6281234567890',
      mediatype: 'image',
      mimetype: 'image/png',
      caption: 'lihat',
      media: 'QUJD',
    });
  });

  test('dokumen memakai mediatype document dan wajib membawa fileName', async () => {
    const backend = new MockBackend([MockBackend.json({ key: { id: 'doc-1' } })]);

    await provider(backend).sendFile({
      destination: '0811',
      file: 'data:application/pdf;base64,QUJD',
      filename: 'laporan.pdf',
    });

    expect(backend.lastJson()).toEqual({
      number: '62811',
      mediatype: 'document',
      mimetype: 'application/pdf',
      media: 'QUJD',
      // Tanpa `fileName`, Evolution menolak dokumen berbasis base64 dengan
      // HTTP 400.
      fileName: 'laporan.pdf',
    });
  });

  test('URL publik dikirim apa adanya supaya server yang mengunduh', async () => {
    const backend = new MockBackend([MockBackend.json({ key: { id: 'url-1' } })]);

    await provider(backend).sendImage({
      destination: '0811',
      image: 'https://contoh.test/foto.png',
      filename: 'foto.png',
    });

    expect(backend.lastJson()['media']).toBe('https://contoh.test/foto.png');
  });
});

describe('EvolutionAPI — indikator ketik', () => {
  test('composing mengirim delay dalam milidetik', async () => {
    const backend = new MockBackend([MockBackend.json({ presence: 'composing' })]);

    const result = await provider(backend).sendTyping({
      destination: '081234567890',
      state: 'composing',
      duration: 5,
    });

    expect(result).toBe('Sukses, indikator sedang mengetik dikirim ke 6281234567890');
    expect(backend.lastUrl()).toBe(`${BASE}/chat/sendPresence/${INSTANCE}`);
    // Skema Evolution menandai `delay` wajib dan satuannya milidetik.
    expect(backend.lastJson()).toEqual({
      number: '6281234567890',
      presence: 'composing',
      delay: 5000,
    });
  });

  test('paused tidak butuh durasi', async () => {
    const backend = new MockBackend([MockBackend.json({ presence: 'paused' })]);

    await provider(backend).sendTyping({ destination: '0811', state: 'paused' });

    expect(backend.lastJson()).toEqual({
      number: '62811',
      presence: 'paused',
      delay: 0,
    });
  });

  test('presence yang menahan sendiri membuat klien tidak menunggu dua kali', async () => {
    const backend = new MockBackend([
      // Request pertama: presence. Request kedua: pesannya sendiri.
      MockBackend.json({ presence: 'composing' }),
      MockBackend.json({ key: { id: 'a' } }),
    ]);

    const slept: number[] = [];
    AbstractProvider.useSleeper((seconds) => {
      slept.push(seconds);
    });

    const result = await provider(backend).sendMessage({
      destination: '0811',
      message: 'halo',
      // Menyalakan indikator ketik untuk panggilan ini saja.
      typing: { speed: 8 },
    });

    expect(result).toBe('Sukses, messageId: a');
    expect(backend.count()).toBe(2);
    expect(backend.urlAt(0)).toBe(`${BASE}/chat/sendPresence/${INSTANCE}`);
    expect(backend.urlAt(1)).toBe(`${BASE}/message/sendText/${INSTANCE}`);
    // Evolution sudah menunggu di sisinya lewat `delay` milidetik, jadi SDK
    // tidak boleh menidurkan dirinya sekali lagi — `slept` harus tetap kosong.
    expect(slept).toEqual([]);
  });
});

describe('EvolutionAPI — sesi/instance', () => {
  test('createSession mengirim instanceName dan membaca hash instance', async () => {
    const backend = new MockBackend([
      MockBackend.json({
        instance: { instanceName: INSTANCE, status: 'connecting', owner: '6281', profileName: 'Toko' },
        hash: { apikey: 'inst-key' },
        qrcode: { base64: 'QUJD' },
      }),
    ]);

    const session = await provider(backend).createSession();

    expect(backend.lastUrl()).toBe(`${BASE}/instance/create`);
    expect(backend.lastJson()).toEqual({ instanceName: INSTANCE, qrcode: true });
    expect(session.provider).toBe('EvolutionAPI');
    expect(session.id).toBe(INSTANCE);
    expect(session.status).toBe('connecting');
    expect(session.isConnected()).toBe(false);
    expect(session.qr).toBe('data:image/png;base64,QUJD');
    expect(session.token).toBe('inst-key');
    expect(session.phoneNumber).toBe('6281');
    expect(session.profileName).toBe('Toko');
  });

  test('nama instance bersimbol ditolak sebelum ada request', async () => {
    const backend = new MockBackend([]);

    await expect(
      provider(backend).createSession({ instanceName: 'Siku-Bot' }),
    ).rejects.toThrow(ConfigurationException);
    await expect(
      provider(backend).createSession({ instanceName: 'Siku-Bot' }),
    ).rejects.toThrow('Nama instance Evolution API hanya boleh huruf kecil dan angka');

    expect(backend.count()).toBe(0);
  });

  test('checkSession menandai state open sebagai tersambung', async () => {
    const backend = new MockBackend([
      MockBackend.json({ instance: { state: 'open', instanceName: INSTANCE } }),
    ]);

    const session = await provider(backend).checkSession();

    expect(backend.lastUrl()).toBe(`${BASE}/instance/connectionState/${INSTANCE}`);
    expect(session.status).toBe('open');
    expect(session.isConnected()).toBe(true);
  });

  test('showQr membaca base64 di akar body menjadi data URI', async () => {
    const backend = new MockBackend([
      MockBackend.json({ base64: 'ZZZ', instance: { state: 'close', instanceName: INSTANCE } }),
    ]);

    const session = await provider(backend).showQr();

    expect(backend.lastUrl()).toBe(`${BASE}/instance/connect/${INSTANCE}`);
    expect(session.status).toBe('close');
    expect(session.qr).toBe('data:image/png;base64,ZZZ');
    expect(session.hasQr()).toBe(true);
  });
});

describe('EvolutionAPI — konfigurasi', () => {
  test('WHATSAPP_INSTANCE_EvolutionAPI menang atas WHATSAPP_INSTANCE bersama', async () => {
    fakeEnv({
      WHATSAPP_URL: 'https://v7.test',
      WHATSAPP_INSTANCE: 'inst-bersama',
      WHATSAPP_INSTANCE_EvolutionAPI: 'inst-evo',
      WHATSAPP_TOKEN_EvolutionAPI: 'api-key',
    });

    const backend = new MockBackend([MockBackend.json({ key: { id: 'a' } })]);

    await new EvolutionAPI(null, backend.executor()).sendMessage({
      destination: '0811',
      message: 'a',
    });

    // Supaya Evolution API dan ApiMe bisa memakai instance berbeda dalam satu
    // aplikasi tanpa saling menimpa.
    expect(backend.lastUrl()).toBe(`${BASE}/message/sendText/inst-evo`);
  });

  test('getProvider dan getInstanceName mengembalikan nilai terpasang', () => {
    const api = new EvolutionAPI({ token: 'api-key', url: BASE, instance: INSTANCE });

    expect(api.getProvider()).toBe('EvolutionAPI');
    expect(api.getInstanceName()).toBe(INSTANCE);
    expect(EvolutionAPI.NAME).toBe('EvolutionAPI');
    expect(EvolutionAPI.DEFAULT_URL).toBe('https://evolution-api.whatsapp.com');
  });
});
