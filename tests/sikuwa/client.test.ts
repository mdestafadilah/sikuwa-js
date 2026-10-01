import { afterEach, describe, expect, test } from 'bun:test';
import { Client } from '../../src/lib/sikuwa/client';
import { Config } from '../../src/lib/sikuwa/config';
import {
  ApiException,
  ConfigurationException,
  UnknownProviderException,
} from '../../src/lib/sikuwa/exceptions';
import type { AbstractProvider } from '../../src/lib/sikuwa/providers/abstract-provider';
import { Fonnte } from '../../src/lib/sikuwa/providers/fonnte/fonnte';
import { OpenWA } from '../../src/lib/sikuwa/providers/openwa/openwa';
import { Wuzapi } from '../../src/lib/sikuwa/providers/wuzapi/wuzapi';
import { MockBackend } from './mock-backend';

/**
 * Porting dari `tests/ClientTest.php`.
 *
 * Yang dijaga di sini adalah pemilihan gateway: ejaan nama diseragamkan ke
 * `PROVIDERS` (bukan apa yang diketik pemanggil), `auto` hanya mengundi di
 * antara gateway yang punya token sendiri, dan `notify()` mengubah kegagalan
 * menjadi teks alih-alih melempar.
 */

function fakeEnv(values: Record<string, string>): void {
  Config.useResolver((key) => values[key] ?? null);
}

/** Jalankan dan kembalikan exception-nya, supaya jenisnya bisa diperiksa. */
async function capture(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
  } catch (error) {
    return error;
  }

  throw new Error('Seharusnya melempar exception, tapi berhasil');
}

afterEach(() => {
  Config.useResolver(null);
});

describe('Client — pemilihan gateway', () => {
  test('mengenali nama provider tanpa peduli huruf besar-kecil', () => {
    const client = new Client({ provider: 'fonnte' });

    expect(client.provider()).toBeInstanceOf(Fonnte);
    expect(client.provider().getProvider()).toBe('Fonnte');
  });

  /**
   * Inti fitur ini: nama gateway bisa diketahui tanpa membangun objeknya, dan
   * ejaannya mengikuti `PROVIDERS` — bukan apa yang diketik pemanggil.
   */
  test('providerName mengembalikan ejaan resmi tanpa membangun gateway', () => {
    const client = new Client({ provider: 'openwa' });

    expect(client.providerName()).toBe('OpenWA');
  });

  test('providerName jatuh ke environment bila tidak diberikan', () => {
    fakeEnv({ WHATSAPP_PROVIDER: 'Wuzapi' });

    expect(new Client().providerName()).toBe('Wuzapi');
  });

  test('providerName menang atas environment dan auto', () => {
    fakeEnv({ WHATSAPP_PROVIDER: 'Auto', WHATSAPP_TOKEN_Wuzapi: 'k' });

    expect(new Client().providerName('fonnte')).toBe('Fonnte');
  });

  /**
   * Nama yang dikembalikan harus salah satu kandidat yang punya token — bukan
   * gateway yang tidak dikonfigurasi.
   */
  test('providerName dengan auto memilih dari gateway yang dikonfigurasi', () => {
    fakeEnv({
      WHATSAPP_PROVIDER: 'Auto',
      WHATSAPP_TOKEN_Wuzapi: 'k1',
      WHATSAPP_TOKEN_OpenWA: 'k2',
    });

    expect(['Wuzapi', 'OpenWA']).toContain(new Client().providerName());
  });

  test('providerName menolak gateway yang tidak dikenal', () => {
    expect(() => new Client({ provider: 'NopeApi' }).providerName()).toThrow(
      UnknownProviderException,
    );
    expect(() => new Client({ provider: 'NopeApi' }).providerName()).toThrow('NopeApi');
  });

  test('providerName menolak provider yang belum diisi', () => {
    fakeEnv({});

    expect(() => new Client().providerName()).toThrow(ConfigurationException);
  });

  test('providerName dengan auto tanpa kandidat ditolak', () => {
    fakeEnv({ WHATSAPP_PROVIDER: 'Auto' });

    expect(() => new Client().providerName()).toThrow(
      "WHATSAPP_PROVIDER 'auto' tidak punya kandidat",
    );
  });

  test('mengenali provider dari environment', () => {
    fakeEnv({ WHATSAPP_PROVIDER: 'Wuzapi' });

    expect(new Client().provider()).toBeInstanceOf(Wuzapi);
  });

  test('provider eksplisit menang atas environment', () => {
    fakeEnv({ WHATSAPP_PROVIDER: 'Wuzapi' });

    expect(new Client({ provider: 'OpenWA' }).provider()).toBeInstanceOf(OpenWA);
  });

  test('provider yang tidak dikenal ditolak', () => {
    const client = new Client({ provider: 'NopeApi' });

    expect(() => client.provider()).toThrow(UnknownProviderException);
    expect(() => client.provider()).toThrow('NopeApi');
  });

  test('provider yang belum dikonfigurasi ditolak', () => {
    fakeEnv({});

    expect(() => new Client().provider()).toThrow(ConfigurationException);
  });

  test('configured hanya mendaftar provider yang punya token sendiri', () => {
    fakeEnv({
      WHATSAPP_TOKEN: 'umum',
      WHATSAPP_TOKEN_OpenWA: 'owa',
      WHATSAPP_TOKEN_Wuzapi: 'wuz',
    });

    expect(Client.configured()).toEqual(['OpenWA', 'Wuzapi']);
  });

  test('configured mengabaikan token umum', () => {
    fakeEnv({ WHATSAPP_TOKEN: 'umum' });

    expect(Client.configured()).toEqual([]);
  });

  test('auto hanya mengundi di antara provider yang dikonfigurasi', () => {
    fakeEnv({ WHATSAPP_TOKEN_Fonnte: 'tok' });

    expect(new Client({ provider: 'auto' }).provider()).toBeInstanceOf(Fonnte);
  });

  test('auto tanpa kandidat ditolak', () => {
    fakeEnv({ WHATSAPP_TOKEN: 'umum' });

    expect(() => new Client({ provider: 'auto' }).provider()).toThrow(
      ConfigurationException,
    );
    expect(() => new Client({ provider: 'auto' }).provider()).toThrow('auto');
  });

  test('peta providers memuat seluruh gateway, dalam urutan yang tetap', () => {
    expect(Object.keys(Client.providers())).toEqual([
      'Fonnte',
      'OpenWA',
      'ApiMe',
      'EvolutionAPI',
      'Wuzapi',
      'Wwebjs',
      'Waxum',
    ]);
  });

  test('setiap kelas di providers benar-benar bisa dibangun', () => {
    // Nama yang terdaftar tapi kelasnya tidak bisa dibangun akan baru ketahuan
    // saat mode `auto` kebetulan memilihnya — yaitu di produksi.
    for (const [name, Constructor] of Object.entries(Client.providers())) {
      const built = new Constructor({ token: 'tok' }, null);

      expect(built.getProvider()).toBe(name);
    }
  });
});

describe('Client — pengiriman', () => {
  test('send mengembalikan hasil provider', async () => {
    const backend = new MockBackend([MockBackend.json({ status: true, detail: '1/1' })]);
    const client = new Client({ provider: 'Fonnte', token: 'tok' }, backend.client());

    expect(await client.send({ destination: '081234567890', message: 'halo' })).toBe(
      'Sukses: 1/1',
    );
  });

  test('notify mengembalikan teks error alih-alih melempar', async () => {
    const backend = new MockBackend([
      MockBackend.json({ status: false, reason: 'token tidak valid' }),
    ]);
    const client = new Client({ provider: 'Fonnte', token: 'tok' }, backend.client());

    expect(await client.notify({ destination: '081234567890', message: 'halo' })).toBe(
      'token tidak valid',
    );
  });

  test('send meneruskan kegagalan sebagai exception', async () => {
    const backend = new MockBackend([
      MockBackend.json({ status: false, reason: 'token tidak valid' }),
    ]);
    const client = new Client({ provider: 'Fonnte', token: 'tok' }, backend.client());

    await expect(
      client.send({ destination: '081234567890', message: 'halo' }),
    ).rejects.toThrow('token tidak valid');
  });

  test('kegagalan transport pun berakhir sebagai ApiException', async () => {
    const backend = new MockBackend([
      MockBackend.connectionFailure(),
      MockBackend.connectionFailure(),
    ]);
    const client = new Client({ provider: 'Fonnte', token: 'tok' }, backend.client());

    const error = await capture(() =>
      client.send({ destination: '081234567890', message: 'halo' }),
    );

    expect(error).toBeInstanceOf(ApiException);
    expect((error as ApiException).message).toContain('Gagal menghubungi Fonnte');

    // Jalur inilah yang membuat `notify()` berguna: DNS mati pun tetap terukur
    // sebagai teks, bukan proses yang berhenti.
    await expect(
      client.notify({ destination: '081234567890', message: 'halo' }),
    ).resolves.toContain('Gagal menghubungi Fonnte');
  });

  test('klien HTTP bisa disuntikkan lewat opsi', async () => {
    const backend = new MockBackend([MockBackend.json({ status: true })]);
    const client = new Client({
      provider: 'Fonnte',
      token: 'tok',
      httpClient: backend.client(),
    });

    await client.send({ destination: '081234567890', message: 'halo' });

    expect(backend.count()).toBe(1);
  });

  test('timeout dari konfigurasi sampai ke executor', () => {
    const client = new Client({ provider: 'Fonnte', timeout: 30 });

    expect(client.http.timeout()).toBe(30);
  });

  test('config dan http tersedia sebagai properti', () => {
    const client = new Client({ provider: 'Fonnte', token: 'tok' });

    // Di PHP keduanya method (`config()`, `http()`); JavaScript tidak bisa
    // memakai nama yang sama untuk properti dan method sekaligus.
    expect(client.config.provider()).toBe('Fonnte');
    expect(client.config.token()).toBe('tok');
  });

  test('enabled membaca WA_NOTIFICATION, dan bawaannya menyala', () => {
    fakeEnv({});
    expect(new Client().enabled()).toBe(true);

    fakeEnv({ WA_NOTIFICATION: '0' });
    expect(new Client().enabled()).toBe(false);

    fakeEnv({ WA_NOTIFICATION: '1' });
    expect(new Client().enabled()).toBe(true);
  });
});

describe('Client — penjagaan', () => {
  test('notify hanya menelan WhatsappException, bukan error lain', async () => {
    // Bug di kode pemanggil tidak boleh berubah menjadi teks yang terlihat
    // seperti kegagalan pengiriman: itu menyembunyikan sebabnya.
    const client = new BrokenClient({ provider: 'Fonnte', token: 'tok' });

    await expect(
      client.notify({ destination: '081234567890', message: 'halo' }),
    ).rejects.toThrow(TypeError);
  });

  test('sesi diteruskan ke gateway yang dipilih', async () => {
    const backend = new MockBackend([
      MockBackend.json({ qrCode: 'data:image/png;base64,AAA', status: 'qr_ready' }),
    ]);
    const client = new Client(
      { provider: 'OpenWA', token: 'tok', url: 'https://owa.test', session: 'siku-1' },
      backend.client(),
    );

    const session = await client.showQr();

    expect(session.provider).toBe('OpenWA');
    expect(session.hasQr()).toBe(true);
    expect(backend.lastUrl()).toBe('https://owa.test/api/sessions/siku-1/qr');
  });
});

/** Client yang `provider()`-nya meledak dengan error biasa, bukan WhatsappException. */
class BrokenClient extends Client {
  override provider(): AbstractProvider {
    throw new TypeError('bug di kode pemanggil');
  }
}
