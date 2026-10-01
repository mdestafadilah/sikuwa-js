import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Config, type ConfigOptions } from '../../../src/lib/sikuwa/config';
import {
  ApiException,
  ConfigurationException,
  NotFoundException,
  RateLimitException,
  TimeoutException,
} from '../../../src/lib/sikuwa/exceptions';
import { AbstractProvider } from '../../../src/lib/sikuwa/providers/abstract-provider';
import { Fonnte } from '../../../src/lib/sikuwa/providers/fonnte/fonnte';
import { MockBackend } from '../mock-backend';

/**
 * Porting dari `tests/Providers/FonnteTest.php`, ditambah bagian yang hanya
 * bisa dibuktikan di sini (Device API, presence, dan unggahan berkas).
 *
 * Fonnte adalah pilot porting karena ia yang paling kaya fitur sekaligus
 * paling berbeda dari gateway lain: satu host tetap, amplop yang selalu
 * membalas HTTP 200, dan dua kredensial yang mudah tertukar — token perangkat
 * untuk mengirim, token akun untuk mengurus perangkat. Yang dijaga test ini
 * adalah aturan-aturan itu, bukan sekadar bentuk request-nya.
 */

const DEFAULT_URL = 'https://api.fonnte.com/send';

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

function provider(backend: MockBackend, options: ConfigOptions = {}): Fonnte {
  return new Fonnte({ token: 'tok', ...options }, backend.executor());
}

/** Isi field `data` — daftar pesan yang benar-benar dikirim ke Fonnte. */
function sentMessages(backend: MockBackend): unknown {
  return JSON.parse(backend.lastForm()['data'] ?? '[]') as unknown;
}

beforeEach(() => {
  Config.useResolver(() => null);
  AbstractProvider.useSleeper(null);
});

afterEach(() => {
  Config.useResolver(null);
  AbstractProvider.useSleeper(null);
});

describe('Fonnte — pengiriman teks', () => {
  test('mengirim satu pesan sebagai data form-encoded', async () => {
    const backend = new MockBackend([MockBackend.json({ status: true })]);

    const result = await provider(backend).sendMessage({
      destination: '081234567890',
      message: 'halo',
    });

    expect(result).toBe('Sukses');
    expect(backend.count()).toBe(1);
    expect(backend.lastUrl()).toBe(DEFAULT_URL);
    expect(backend.methodAt(0)).toBe('POST');
    expect(backend.lastHeader('Authorization')).toBe('tok');
    expect(backend.lastHeader('Content-Type')).toContain('application/x-www-form-urlencoded');

    // `delay` adalah string di sisi Fonnte, dan bawaannya 2 detik.
    expect(sentMessages(backend)).toEqual([
      { target: '081234567890', message: 'halo', delay: '2' },
    ]);
  });

  test('mengirim bulk dalam satu request', async () => {
    const backend = new MockBackend([MockBackend.json({ status: true, detail: '2/2' })]);

    const result = await provider(backend).sendMessage([
      { destination: '0811', message: 'a' },
      { destination: '0822', message: 'b', delay: 5 },
    ]);

    expect(result).toBe('Sukses: 2/2');
    expect(backend.count()).toBe(1);
    expect(sentMessages(backend)).toEqual([
      { target: '0811', message: 'a', delay: '2' },
      { target: '0822', message: 'b', delay: '5' },
    ]);
  });

  test('detail berupa daftar diratakan menjadi satu kalimat', async () => {
    const backend = new MockBackend([
      MockBackend.json({ status: true, detail: ['a', 'b'] }),
    ]);

    const result = await provider(backend).sendMessage({
      destination: '0811',
      message: 'a',
    });

    expect(result).toBe('Sukses: a; b');
  });

  test('detail kosong tetap dilaporkan sebagai Sukses', async () => {
    const backend = new MockBackend([MockBackend.json({ status: true, detail: '' })]);

    expect(
      await provider(backend).sendMessage({ destination: '0811', message: 'a' }),
    ).toBe('Sukses');
  });
});

describe('Fonnte — penolakan', () => {
  test('penolakan memakai reason sebagai pesan', async () => {
    const backend = new MockBackend([
      MockBackend.json({ status: false, reason: 'token tidak valid' }),
    ]);

    const error = await capture(() =>
      provider(backend).sendMessage({ destination: '0811', message: 'a' }),
    );

    expect(error).toBeInstanceOf(ApiException);
    expect((error as ApiException).message).toBe('token tidak valid');
    // Fonnte membalas HTTP 200 bahkan saat menolak; statusnya tetap 200.
    expect((error as ApiException).getStatus()).toBe(200);
  });

  test('penolakan tanpa reason tetap menjelaskan diri', async () => {
    const backend = new MockBackend([MockBackend.json({ status: false })]);

    const error = await capture(() =>
      provider(backend).sendMessage({ destination: '0811', message: 'a' }),
    );

    expect((error as ApiException).message).toBe('Fonnte menolak pesan (HTTP 200)');
  });

  test('body 2xx yang bukan JSON tidak pernah dilaporkan sebagai sukses', async () => {
    const backend = new MockBackend([MockBackend.raw()]);

    const error = await capture(() =>
      provider(backend).sendMessage({ destination: '0811', message: 'a' }),
    );

    expect((error as ApiException).message).toBe('Respons Fonnte tidak valid (HTTP 200)');
  });

  test('error server ditolak dengan detail dari amplopnya', async () => {
    const backend = new MockBackend([MockBackend.json({ error: 'boom' }, 500)]);

    const error = await capture(() =>
      provider(backend).sendMessage({ destination: '0811', message: 'a' }),
    );

    expect((error as ApiException).message).toBe('Fonnte menolak pesan (HTTP 500): boom');
  });

  test('timeout dilaporkan sebagai TimeoutException', async () => {
    const backend = new MockBackend([MockBackend.timeout()]);

    const error = await capture(() =>
      provider(backend).sendMessage({ destination: '0811', message: 'a' }),
    );

    expect(error).toBeInstanceOf(TimeoutException);
  });

  test('kegagalan koneksi dilaporkan sebagai ApiException', async () => {
    const backend = new MockBackend([MockBackend.connectionFailure()]);

    const error = await capture(() =>
      provider(backend).sendMessage({ destination: '0811', message: 'a' }),
    );

    expect(error).toBeInstanceOf(ApiException);
    expect((error as ApiException).message).toContain('Gagal menghubungi Fonnte');
    expect((error as ApiException).getStatus()).toBe(0);
  });
});

describe('Fonnte — bentuk pesan yang ditolak', () => {
  test('pesan berupa string ditolak sebelum ada request', async () => {
    const backend = new MockBackend();

    await expect(provider(backend).sendMessage('halo')).rejects.toThrow(
      'Format pesan tidak valid: Fonnte membutuhkan array pesan',
    );
    expect(backend.count()).toBe(0);
  });

  test('pesan tanpa destination ditolak', async () => {
    const backend = new MockBackend();

    await expect(provider(backend).sendMessage({ message: 'halo' })).rejects.toThrow(
      'Pesan ke-0',
    );
    expect(backend.count()).toBe(0);
  });
});

describe('Fonnte — pemilihan URL dan token', () => {
  /**
   * Fonnte adalah layanan cloud dengan endpoint tetap. Kalau `WHATSAPP_URL`
   * ikut dibaca, satu nilai yang ditujukan untuk gateway self-hosted akan
   * mengalihkan pengiriman ke host yang salah.
   */
  test('mengabaikan WHATSAPP_URL dari environment', async () => {
    fakeEnv({ WHATSAPP_URL: 'http://localhost:2785', WHATSAPP_TOKEN: 'dari-env' });
    const backend = new MockBackend([MockBackend.json({ status: true })]);

    await new Fonnte(null, backend.executor()).sendMessage({
      destination: '0811',
      message: 'a',
    });

    expect(backend.lastUrl()).toBe(DEFAULT_URL);
    expect(backend.lastHeader('Authorization')).toBe('dari-env');
  });

  test('URL eksplisit menang atas default', async () => {
    const backend = new MockBackend([MockBackend.json({ status: true })]);

    await provider(backend, { url: 'https://proxy.test/send' }).sendMessage({
      destination: '0811',
      message: 'a',
    });

    expect(backend.lastUrl()).toBe('https://proxy.test/send');
  });

  /**
   * Device API diturunkan dari URL pengiriman, bukan ditulis ulang — supaya
   * override lewat proxy ikut berlaku untuk endpoint perangkat.
   */
  test('Device API mengikuti host pengiriman, tanpa sufiks /send', async () => {
    const backend = new MockBackend([
      MockBackend.json({ status: true, url: 'iVBORw0KGgo=' }),
    ]);

    await provider(backend, { url: 'https://proxy.test/send' }).showQr();

    expect(backend.lastUrl()).toBe('https://proxy.test/qr');
  });

  test('token provider menang atas token umum', async () => {
    fakeEnv({ WHATSAPP_TOKEN: 'umum', WHATSAPP_TOKEN_Fonnte: 'khusus' });
    const backend = new MockBackend([MockBackend.json({ status: true })]);

    await new Fonnte(null, backend.executor()).sendMessage({
      destination: '0811',
      message: 'a',
    });

    expect(backend.lastHeader('Authorization')).toBe('khusus');
  });
});

describe('Fonnte — indikator ketik', () => {
  test('menampilkan indikator mengetik lewat POST /typing', async () => {
    const backend = new MockBackend([MockBackend.json({ status: true })]);

    const result = await provider(backend).sendTyping({
      destination: '0812',
      state: 'composing',
      duration: 5,
    });

    expect(result).toBe('Sukses, indikator sedang mengetik dikirim ke 62812');
    expect(backend.lastUrl()).toBe('https://api.fonnte.com/typing');
    expect(backend.lastForm()).toEqual({ target: '62812', duration: '5' });
  });

  test('berhenti mengetik memakai kolom stop, bukan endpoint lain', async () => {
    const backend = new MockBackend([MockBackend.json({ status: true })]);

    await provider(backend).sendTyping({ destination: '0812', state: 'paused' });

    expect(backend.lastUrl()).toBe('https://api.fonnte.com/typing');
    expect(backend.lastForm()).toEqual({ target: '62812', duration: '0', stop: 'true' });
  });

  /**
   * Fonnte tidak punya indikator merekam suara. Diam-diam mengirimnya sebagai
   * "sedang mengetik" akan membuat penerima melihat hal yang salah.
   */
  test('recording ditolak dengan jelas', async () => {
    const backend = new MockBackend();

    await expect(
      provider(backend).sendTyping({ destination: '0812', state: 'recording', duration: 5 }),
    ).rejects.toThrow('Fonnte tidak punya indikator merekam suara');
    expect(backend.count()).toBe(0);
  });

  test('nomor tujuan yang tidak bisa dibaca ditolak sebelum ada request', async () => {
    const backend = new MockBackend();

    await expect(
      provider(backend).sendTyping({ destination: 'bukan-nomor', duration: 5 }),
    ).rejects.toThrow('tidak valid');
    expect(backend.count()).toBe(0);
  });
});

describe('Fonnte — unggahan berkas', () => {
  test('mengirim berkas sebagai multipart, bukan base64 di dalam JSON', async () => {
    const backend = new MockBackend([MockBackend.json({ status: true, detail: 'terkirim' })]);

    const result = await provider(backend).sendImage({
      destination: '0811',
      image: 'data:image/png;base64,iVBORw0KGgo=',
      caption: 'Bukti transfer',
    });

    expect(result).toBe('Sukses: terkirim');
    expect(backend.lastUrl()).toBe(DEFAULT_URL);

    const parts = backend.lastMultipart();
    expect(parts.map(([name]) => name)).toEqual(['target', 'filename', 'message', 'file']);
    expect(parts[0]?.[1]).toBe('62811');
    expect(parts[2]?.[1]).toBe('Bukti transfer');

    // Bagian berkasnya harus berupa biner yang sudah dinamai dan diberi jenis,
    // karena itulah yang dibaca Fonnte untuk menentukan gambarnya.
    const uploaded = parts[3]?.[1];
    expect(uploaded).toBeInstanceOf(File);
    expect((uploaded as File).name).toBe('lampiran.png');
    expect((uploaded as File).type).toBe('image/png');

    // `boundary` hanya diketahui runtime, jadi Content-Type tidak boleh diisi.
    expect(backend.lastHeader('Content-Type')).toBe('');
  });

  test('URL publik diteruskan sebagai kolom url, bukan diunduh SDK', async () => {
    const backend = new MockBackend([MockBackend.json({ status: true })]);

    await provider(backend).sendFile({
      destination: '0811',
      file: 'https://contoh.test/dokumen.pdf',
    });

    const parts = backend.lastMultipart();
    expect(parts.map(([name]) => name)).toEqual(['target', 'filename', 'url']);
    expect(parts[2]?.[1]).toBe('https://contoh.test/dokumen.pdf');
  });

  test('berkas melebihi 16 MB ditolak sebelum terunggah', async () => {
    const backend = new MockBackend();

    // Panjang base64 harus kelipatan empat supaya benar-benar sah — `size()`
    // menghitung dari panjangnya, jadi base64 yang cacat akan dilaporkan
    // lebih kecil daripada isinya. Angka di bawah ini yang terkecil yang
    // masih melewati batas 16 MB.
    const base64Length = Math.ceil((16 * 1024 * 1024 + 1) / 3) * 4;
    const tooBig = 'A'.repeat(base64Length);

    await expect(
      provider(backend).sendImage({ destination: '0811', image: tooBig }),
    ).rejects.toThrow('melebihi batas WhatsApp 16 MB');
    expect(backend.count()).toBe(0);
  });
});

describe('Fonnte — QR perangkat', () => {
  test('base64 telanjang dirangkai menjadi data URI', async () => {
    const backend = new MockBackend([
      MockBackend.json({ status: true, device: '62811', url: 'iVBORw0KGgo=' }),
    ]);

    const session = await provider(backend).showQr();

    expect(session.status).toBe('qr_ready');
    expect(session.id).toBe('62811');
    expect(session.qr).toBe('data:image/png;base64,iVBORw0KGgo=');
    expect(session.qrImage()).toBe('data:image/png;base64,iVBORw0KGgo=');
    expect(session.qrBase64()).toBe('iVBORw0KGgo=');
    expect(session.isConnected()).toBe(false);
    expect(backend.lastJson()).toEqual({ type: 'qr' });
  });

  test('nomor perangkat ikut dikirim sebagai whatsapp bila disebut', async () => {
    const backend = new MockBackend([MockBackend.json({ status: true, url: 'x' })]);

    await provider(backend).showQr('0812');

    expect(backend.lastJson()).toEqual({ type: 'qr', whatsapp: '62812' });
  });

  /**
   * Perangkat yang sudah tersambung tidak menerima QR melainkan penolakan
   * `device already connect`. Itu keadaan, bukan kegagalan.
   */
  test('perangkat yang sudah tersambung dilaporkan sebagai sesi connected', async () => {
    const backend = new MockBackend([
      MockBackend.json({ status: false, reason: 'device already connect' }),
    ]);

    const session = await provider(backend).showQr();

    expect(session.isConnected()).toBe(true);
    expect(session.hasQr()).toBe(false);
    expect(session.status).toBe('connect');
  });
});

describe('Fonnte — Device API', () => {
  test('membuat perangkat memakai account token, bukan token perangkat', async () => {
    const backend = new MockBackend([
      MockBackend.json({ status: true, device: '62811', name: 'Bot', token: 'dev-tok' }),
    ]);

    const session = await provider(backend, { account_token: 'acct' }).createSession({
      name: 'Bot',
      device: '0811',
    });

    expect(backend.lastUrl()).toBe('https://api.fonnte.com/add-device');
    expect(backend.lastHeader('Authorization')).toBe('acct');
    expect(backend.lastJson()).toEqual({ name: 'Bot', device: '62811' });

    expect(session.status).toBe('created');
    expect(session.token).toBe('dev-tok');
    // Perangkat yang baru dibuat belum tersambung.
    expect(session.isConnected()).toBe(false);
  });

  test('flag dibaca sebagai teks "true"/"false", bukan boolean', async () => {
    const backend = new MockBackend([MockBackend.json({ status: true })]);

    await provider(backend, { account_token: 'acct' }).createSession({
      name: 'Bot',
      device: '0811',
      autoread: true,
      personal: false,
    });

    expect(backend.lastJson()).toEqual({
      name: 'Bot',
      device: '62811',
      autoread: 'true',
      personal: 'false',
    });
  });

  test('nama perangkat wajib diisi', async () => {
    const backend = new MockBackend();

    await expect(
      provider(backend, { account_token: 'acct' }).createSession({ device: '0811' }),
    ).rejects.toThrow('membutuhkan nama perangkat');
    expect(backend.count()).toBe(0);
  });

  test('Device API menolak berjalan tanpa account token', async () => {
    const backend = new MockBackend();

    const error = await capture(() =>
      provider(backend).createSession({ name: 'Bot', device: '0811' }),
    );

    expect(error).toBeInstanceOf(ConfigurationException);
    expect((error as ConfigurationException).message).toContain('WHATSAPP_ACCOUNT_TOKEN');
    expect(backend.count()).toBe(0);
  });

  test('checkSession membaca keadaan perangkat yang sebenarnya', async () => {
    const backend = new MockBackend([
      MockBackend.json({
        status: true,
        data: [{ device: '62811', name: 'Bot', token: 'dev-tok', status: 'connect' }],
      }),
    ]);

    const session = await provider(backend, { account_token: 'acct' }).checkSession('62811');

    expect(backend.lastUrl()).toBe('https://api.fonnte.com/get-devices');
    expect(session.id).toBe('62811');
    expect(session.connected).toBe(true);
    expect(session.profileName).toBe('Bot');
  });

  test('checkSession tanpa argumen memakai token perangkat yang sedang dipakai', async () => {
    const backend = new MockBackend([
      MockBackend.json({
        status: true,
        data: [{ device: '62811', token: 'tok', status: 'disconnect' }],
      }),
    ]);

    const session = await provider(backend, { account_token: 'acct' }).checkSession();

    expect(session.id).toBe('62811');
    expect(session.isConnected()).toBe(false);
    expect(session.status).toBe('disconnect');
  });

  test('perangkat yang tidak ada dilaporkan sebagai NotFoundException', async () => {
    const backend = new MockBackend([MockBackend.json({ status: true, data: [] })]);

    const error = await capture(() =>
      provider(backend, { account_token: 'acct' }).checkSession('62899'),
    );

    expect(error).toBeInstanceOf(NotFoundException);
    expect((error as NotFoundException).message).toContain('tidak ditemukan di akun Fonnte');
    expect((error as NotFoundException).getStatus()).toBe(404);
  });

  test('checkSession tanpa id dan tanpa token ditolak sebelum ada request', async () => {
    const backend = new MockBackend();

    const error = await capture(() =>
      new Fonnte({ account_token: 'acct' }, backend.executor()).checkSession(),
    );

    expect(error).toBeInstanceOf(ConfigurationException);
    expect(backend.count()).toBe(0);
  });
});

describe('Fonnte — percobaan ulang', () => {
  /**
   * Fonnte mengirim seluruh batch dalam satu request, dan jalur itu **tidak**
   * melewati `withRetry()` — berbeda dari lima gateway yang mengirim satu
   * pesan per request lewat `sendIndividually()`.
   *
   * Ini bukan keputusan porting, melainkan perilaku versi PHP-nya juga:
   * `Fonnte::sendMessage()` memanggil `$this->http->post()` langsung, tanpa
   * `withRetry()`. Docblock `tests/RetryTest.php` menyebut "Fonnte dan OpenWA
   * … percobaan ulangnya pun satu kali untuk seluruh batch", tetapi tidak ada
   * kode yang melakukannya. Porting ini mempertahankan yang benar-benar
   * berjalan, bukan yang tertulis di komentar — dan perbedaannya dilaporkan,
   * bukan diperbaiki diam-diam.
   *
   * Yang tetap berlaku: `Retry-After` ikut dibawa exception-nya, jadi
   * pemanggil masih bisa mengatur ulang jadwalnya sendiri.
   */
  test('batch tidak diulang walau jatah percobaan diisi', async () => {
    const slept: number[] = [];
    AbstractProvider.useSleeper((seconds) => {
      slept.push(seconds);
    });

    const backend = new MockBackend([
      new Response('{}', { status: 429, headers: { 'Retry-After': '7' } }),
    ]);

    const error = await capture(() =>
      provider(backend, { retries: 3 }).sendMessage([
        { destination: '0811', message: 'a' },
        { destination: '0822', message: 'b' },
      ]),
    );

    expect(error).toBeInstanceOf(RateLimitException);
    expect((error as ApiException).getStatus()).toBe(429);
    expect((error as ApiException).getRetryAfter()).toBe(7);
    expect(backend.count()).toBe(1);
    expect(slept).toEqual([]);
  });
});
