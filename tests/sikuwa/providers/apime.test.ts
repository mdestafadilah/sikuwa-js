import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Config, type ConfigOptions } from '../../../src/lib/sikuwa/config';
import {
  ApiException,
  ConfigurationException,
  ForbiddenException,
  ServiceUnavailableException,
  TimeoutException,
} from '../../../src/lib/sikuwa/exceptions';
import { AbstractProvider } from '../../../src/lib/sikuwa/providers/abstract-provider';
import { ApiMe } from '../../../src/lib/sikuwa/providers/apime/apime';
import { ApiMeMessage } from '../../../src/lib/sikuwa/providers/apime/apime-message';
import { MockBackend } from '../mock-backend';

/**
 * Porting dari `tests/Providers/ApiMeTest.php`, ditambah bagian yang tidak ada
 * di versi PHP (unggahan berkas dan presence).
 *
 * ApiMe adalah gateway `sendIndividually` pertama yang diporting: tidak ada
 * endpoint batch sama sekali, jadi beberapa pesan benar-benar dikirim satu per
 * satu dan jedanya menahan pemanggil. Dua hal khas ApiMe yang dijaga di sini:
 * `Idempotency-Key` yang harus **deterministik**, dan konteks tambahan pada
 * pesan error yang menjelaskan arti statusnya.
 */

const BASE = 'https://v14.test';
const INSTANCE = 'inst-uuid';

function fakeEnv(values: Record<string, string>): void {
  Config.useResolver((key) => values[key] ?? null);
}

function provider(backend: MockBackend, options: ConfigOptions = {}): ApiMe {
  return new ApiMe(
    { token: 'instance-token', url: BASE, instance: INSTANCE, ...options },
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

describe('ApiMe — pengiriman teks', () => {
  test('satu pesan menuju messages/text', async () => {
    const backend = new MockBackend([
      MockBackend.json({ data: { whatsappId: '3EB0' } }),
    ]);

    const result = await provider(backend).sendMessage({
      destination: '081234567890',
      message: 'halo',
    });

    expect(result).toBe('Sukses, messageId: 3EB0');
    expect(backend.lastUrl()).toBe(`${BASE}/api/instances/${INSTANCE}/messages/text`);
    expect(backend.lastHeader('Authorization')).toBe('Bearer instance-token');
    expect(backend.lastJson()).toEqual({ to: '6281234567890', text: 'halo' });
  });

  test('jatuh ke `id` saat `whatsappId` tidak ada', async () => {
    const backend = new MockBackend([MockBackend.json({ data: { id: 'fallback-1' } })]);

    const result = await provider(backend).sendMessage({
      destination: '0811',
      message: 'a',
    });

    expect(result).toBe('Sukses, messageId: fallback-1');
  });

  test('JID grup diteruskan apa adanya', async () => {
    const backend = new MockBackend([
      MockBackend.json({ data: { whatsappId: 'a' } }),
    ]);

    await provider(backend).sendMessage({
      destination: '1234567890-123456@g.us',
      message: 'a',
    });

    // Menormalkan JID grup akan merusak identitasnya — nomor di dalamnya
    // bukan nomor telepon yang bisa diberi awalan negara.
    expect(backend.lastJson()['to']).toBe('1234567890-123456@g.us');
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

  test('nomor tujuan yang tidak bisa dibaca ditolak', async () => {
    const backend = new MockBackend([]);

    await expect(
      provider(backend).sendMessage({ destination: 'abc', message: 'a' }),
    ).rejects.toThrow('tidak punya nomor tujuan yang valid');

    expect(backend.count()).toBe(0);
  });

  test('beberapa pesan dikirim satu per satu, bukan satu request', async () => {
    const backend = new MockBackend([
      MockBackend.json({ data: { whatsappId: 'a' } }),
      MockBackend.json({ data: { whatsappId: 'b' } }),
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
      MockBackend.json({ data: { whatsappId: 'ok' } }),
      MockBackend.json({ error: 'nomor tidak terdaftar' }, 400),
    ]);

    const error = await provider(backend)
      .sendMessage([
        { destination: '0811', message: 'a' },
        { destination: '0822', message: 'b' },
      ])
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiException);
    // Pemanggil harus melihat gambaran lengkapnya, bukan cuma kegagalan
    // pertama — karena itu jumlah yang berhasil ikut dilaporkan.
    expect((error as ApiException).message).toContain('1/2 pesan terkirim');
    expect((error as ApiException).message).toContain(
      '62822: ApiMe menolak pesan (HTTP 400): nomor tidak terdaftar',
    );
  });
});

describe('ApiMe — kunci idempotensi', () => {
  test('sama untuk isi yang sama, berbeda untuk isi yang berbeda', async () => {
    const backend = new MockBackend([
      MockBackend.json({ data: { whatsappId: 'a' } }),
      MockBackend.json({ data: { whatsappId: 'b' } }),
      MockBackend.json({ data: { whatsappId: 'c' } }),
    ]);

    const api = provider(backend);

    await api.sendMessage({ destination: '0811', message: 'a' });
    const first = backend.lastHeader('Idempotency-Key');

    await api.sendMessage({ destination: '0811', message: 'a' });
    const second = backend.lastHeader('Idempotency-Key');

    await api.sendMessage({ destination: '0811', message: 'b' });
    const third = backend.lastHeader('Idempotency-Key');

    expect(first).not.toBe('');
    expect(first.startsWith('siku-')).toBe(true);
    expect(second).toBe(first);
    expect(third).not.toBe(first);
  });

  test('nilainya sama persis dengan hash() milik PHP', () => {
    // Nilai harapan di bawah dihitung PHP:
    //   'siku-' . hash('sha256', 'inst-1|6281234567890|halo')
    //
    // Ini pembuktian paritas yang sebenarnya. Kalau kedua implementasi
    // menghasilkan kunci berbeda, aplikasi yang berpindah dari paket PHP ke
    // paket ini akan mengirim pesan yang sama dua kali — tepat pada kasus
    // yang ingin dicegah kunci ini.
    expect(new ApiMeMessage('081234567890', 'halo').idempotencyKey('inst-1')).toBe(
      'siku-a4761c725d2eb84dd71722936d199c6acef2a044635737a94981812bf1e5e612',
    );
  });

  test('memakai nomor yang sudah dinormalkan, bukan yang mentah', () => {
    // Kalau kuncinya dihitung dari nomor mentah, "0811" dan "62811" akan
    // menghasilkan dua kunci berbeda untuk tujuan yang sama.
    const raw = new ApiMeMessage('0811', 'a').idempotencyKey('inst');
    const normalized = new ApiMeMessage('62811', 'a').idempotencyKey('inst');

    expect(raw).toBe(normalized);
  });
});

describe('ApiMe — terjemahan kegagalan', () => {
  test('HTTP 403 menjelaskan bahwa yang dibutuhkan instance token', async () => {
    const backend = new MockBackend([
      MockBackend.json({ error: 'forbidden' }, 403),
    ]);

    const error = await provider(backend)
      .sendMessage({ destination: '0811', message: 'a' })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ForbiddenException);
    // 403 tanpa konteks mudah disalahartikan sebagai masalah kredensial biasa.
    expect((error as ApiException).message).toContain(
      '[token harus instance token, bukan JWT user atau API token global]',
    );
  });

  test('HTTP 503 menjelaskan bahwa sesinya belum siap', async () => {
    const backend = new MockBackend([
      MockBackend.json({ error: 'unavailable' }, 503),
    ]);

    const error = await provider(backend)
      .sendMessage({ destination: '0811', message: 'a' })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect((error as ApiException).message).toContain(
      '[sesi WhatsApp belum siap, tidak ada pesan yang terkirim]',
    );
  });

  test('respons 2xx yang bukan JSON tidak dilaporkan sebagai sukses', async () => {
    const backend = new MockBackend([MockBackend.raw()]);

    await expect(
      provider(backend).sendMessage({ destination: '0811', message: 'a' }),
    ).rejects.toThrow('Respons ApiMe tidak valid (HTTP 200)');
  });

  test('timeout dilaporkan sebagai TimeoutException', async () => {
    const backend = new MockBackend([MockBackend.timeout()]);

    await expect(
      provider(backend).sendMessage({ destination: '0811', message: 'a' }),
    ).rejects.toThrow(TimeoutException);
  });
});

describe('ApiMe — berkas', () => {
  test('gambar diunggah sebagai multipart ke messages/media', async () => {
    const backend = new MockBackend([
      MockBackend.json({ data: { whatsappId: 'img-1' } }),
    ]);

    const result = await provider(backend).sendImage({
      destination: '081234567890',
      image: 'data:image/png;base64,QUJD',
      filename: 'foto.png',
      caption: 'lihat',
    });

    expect(result).toBe('Sukses, messageId: img-1');
    expect(backend.lastUrl()).toBe(`${BASE}/api/instances/${INSTANCE}/messages/media`);

    const parts = backend.lastMultipart();
    expect(parts.map(([name]) => name)).toEqual(['to', 'type', 'caption', 'file']);

    // Berkasnya benar-benar ikut sebagai bagian tersendiri — ApiMe menolak
    // base64 di dalam JSON, jadi ini satu-satunya jalur yang diterima.
    expect(parts.find(([name]) => name === 'to')?.[1]).toBe('6281234567890');
    expect(parts.find(([name]) => name === 'type')?.[1]).toBe('image');
    expect(parts.find(([name]) => name === 'file')?.[1]).not.toBeUndefined();
  });

  test('dokumen memakai kolom fileName, bukan type', async () => {
    const backend = new MockBackend([
      MockBackend.json({ data: { whatsappId: 'doc-1' } }),
    ]);

    await provider(backend).sendFile({
      destination: '0811',
      file: 'data:application/pdf;base64,QUJD',
      filename: 'laporan.pdf',
    });

    expect(backend.lastUrl()).toBe(`${BASE}/api/instances/${INSTANCE}/messages/document`);

    const parts = backend.lastMultipart();
    expect(parts.map(([name]) => name)).toEqual(['to', 'fileName', 'file']);
    expect(parts.find(([name]) => name === 'fileName')?.[1]).toBe('laporan.pdf');
  });

  test('URL publik ditolak dengan penjelasan, bukan kegagalan unggah', async () => {
    const backend = new MockBackend([]);

    // ApiMe tidak mengunduh apa pun sendiri; ia hanya menerima unggahan.
    await expect(
      provider(backend).sendImage({
        destination: '0811',
        image: 'https://contoh.test/foto.png',
        filename: 'foto.png',
      }),
    ).rejects.toThrow('ApiMe menerima berkasnya sebagai unggahan biner, bukan URL');

    expect(backend.count()).toBe(0);
  });
});

describe('ApiMe — indikator ketik', () => {
  test('composing dikirim apa adanya', async () => {
    const backend = new MockBackend([MockBackend.json({ success: true })]);

    await provider(backend).sendTyping({
      destination: '081234567890',
      state: 'composing',
      duration: 5,
    });

    expect(backend.lastUrl()).toBe(
      `${BASE}/api/instances/${INSTANCE}/whatsapp/presence`,
    );
    expect(backend.lastJson()).toEqual({ to: '6281234567890', state: 'composing' });
  });

  test('paused dan recording diterjemahkan', async () => {
    const backend = new MockBackend([
      MockBackend.json({ success: true }),
      MockBackend.json({ success: true }),
    ]);

    const api = provider(backend);

    await api.sendTyping({ destination: '0811', state: 'paused' });
    expect(backend.lastJson()).toEqual({ to: '62811', state: 'paused' });

    await api.sendTyping({ destination: '0811', state: 'recording', duration: 5 });
    expect(backend.lastJson()).toEqual({ to: '62811', state: 'recording' });
  });
});

describe('ApiMe — konfigurasi', () => {
  test('akhiran /api pada base URL tidak digandakan', async () => {
    const backend = new MockBackend([
      MockBackend.json({ data: { whatsappId: 'a' } }),
    ]);

    await provider(backend, { url: `${BASE}/api` }).sendMessage({
      destination: '0811',
      message: 'a',
    });

    expect(backend.lastUrl()).toBe(`${BASE}/api/instances/${INSTANCE}/messages/text`);
  });

  test('WHATSAPP_INSTANCE_ApiMe menang atas WHATSAPP_INSTANCE bersama', async () => {
    fakeEnv({
      WHATSAPP_URL: 'https://v14.test',
      WHATSAPP_INSTANCE: 'inst-bersama',
      WHATSAPP_INSTANCE_ApiMe: 'inst-apime',
      WHATSAPP_TOKEN_ApiMe: 'instance-token',
    });

    const backend = new MockBackend([
      MockBackend.json({ data: { whatsappId: 'a' } }),
    ]);

    await new ApiMe(null, backend.executor()).sendMessage({
      destination: '0811',
      message: 'a',
    });

    // Supaya ApiMe dan Evolution API bisa memakai instance berbeda dalam satu
    // aplikasi tanpa saling menimpa.
    expect(backend.lastUrl()).toBe(`${BASE}/api/instances/inst-apime/messages/text`);
  });

  test('createSession menolak nama instance yang kosong', async () => {
    const backend = new MockBackend([]);

    await expect(provider(backend, { instance: '' }).createSession()).rejects.toThrow(
      ConfigurationException,
    );
  });

  test('checkSession membaca status yang berarti siap', async () => {
    const backend = new MockBackend([
      MockBackend.json({ data: { id: INSTANCE, state: 'open' } }),
    ]);

    const session = await provider(backend).checkSession();

    expect(session.status).toBe('open');
    expect(session.isConnected()).toBe(true);
  });
});
