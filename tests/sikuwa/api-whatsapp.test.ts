import { afterEach, describe, expect, test } from 'bun:test';
import whatsappRoute from '../../src/api/whatsapp/route';
import app from '../../src/api/index';
import { Config } from '../../src/lib/sikuwa';

/**
 * Playground Hono di atas pustaka hasil porting.
 *
 * Dua hal yang dibuktikan di sini: pustaka benar-benar berjalan di dalam
 * runtime template (bukan cuma di dalam tes unit), dan kegagalan konfigurasi
 * sampai ke pemanggil HTTP sebagai 400 dengan pesan asli dari SDK.
 *
 * Tidak ada pesan yang dikirim di mana pun — seluruh endpoint playground hanya
 * menghitung.
 */
function fakeEnv(values: Record<string, string>): void {
  Config.useResolver((key) => values[key] ?? null);
}

afterEach(() => {
  Config.useResolver(null);
});

const ENV: Record<string, string> = {
  WHATSAPP_PROVIDER: 'OpenWA',
  WHATSAPP_TOKEN: 'rahasia-token',
  WHATSAPP_URL: 'https://gw.test/',
  WHATSAPP_SESSION: 'sess-1',
  WHATSAPP_TOKEN_Fonnte: 'fonnte-tok',
  WHATSAPP_PACING_CYCLE: '0,30',
  WHATSAPP_THROTTLE_MAX: '50',
  WHATSAPP_TYPING: '1',
};

async function post(path: string, body?: unknown) {
  const response = await whatsappRoute.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? '' : JSON.stringify(body),
  });

  return { status: response.status, payload: (await response.json()) as { message: string; data: unknown } };
}

async function get(path: string) {
  const response = await whatsappRoute.request(path);

  return { status: response.status, payload: (await response.json()) as { message: string; data: unknown } };
}

describe('Playground SIKUWA — /config dan /providers', () => {
  test('ringkasan konfigurasi menyamarkan kredensial', async () => {
    fakeEnv(ENV);

    const { status, payload } = await get('/config');
    const data = payload.data as Record<string, unknown>;

    expect(status).toBe(200);
    expect(data['provider']).toBe('OpenWA');
    expect(data['url']).toBe('https://gw.test');
    expect(data['session']).toBe('sess-1');
    // Token tidak pernah dikirim apa adanya ke peramban.
    expect(data['token']).toBe('raha••••');
  });

  test('hanya token per-provider yang dihitung sebagai siap', async () => {
    fakeEnv(ENV);

    const { payload } = await get('/providers');
    const data = payload.data as { daftar: string[]; siap: string[] };

    expect(data.daftar).toHaveLength(7);
    expect(data.daftar[0]).toBe('Fonnte');
    // WHATSAPP_TOKEN umum tidak membuat OpenWA dianggap siap.
    expect(data.siap).toEqual(['Fonnte']);
  });

  test('pacing, typing, dan throttle yang menyala ikut terbaca', async () => {
    fakeEnv(ENV);

    const { payload } = await get('/config');
    const data = payload.data as Record<string, Record<string, unknown>>;

    expect(data['pacing']?.['aktif']).toBe(true);
    expect(data['pacing']?.['siklus']).toEqual([0, 30]);
    expect(data['typing']?.['aktif']).toBe(true);
    expect(data['throttle']?.['aktif']).toBe(true);
    expect(data['throttle']?.['max']).toBe(50);
  });
});

describe('Playground SIKUWA — pratinjau perhitungan', () => {
  test('pacing memakai siklus dari environment', async () => {
    fakeEnv(ENV);

    const { status, payload } = await post('/pacing/preview', { lengths: [10, 400] });
    const data = payload.data as { jeda: { detik: number | null }[] };

    expect(status).toBe(200);
    // Pesan pertama tanpa jeda; pesan kedua panjang (400 karakter), jadi
    // 30 detik dikali pengali bawaan 3.
    expect(data.jeda.map((item) => item.detik)).toEqual([0, 90]);
  });

  test('opsi pacing dari pemanggil digabung dengan environment', async () => {
    fakeEnv(ENV);

    const { payload } = await post('/pacing/preview', {
      pacing: { cycle: '7' },
      lengths: [10, 10],
    });
    const data = payload.data as { siklus: number[]; jeda: { detik: number | null }[] };

    expect(data.siklus).toEqual([7]);
    expect(data.jeda.map((item) => item.detik)).toEqual([7, 7]);
  });

  test('body kosong tetap memakai nilai bawaan yang masuk akal', async () => {
    fakeEnv(ENV);

    const { status, payload } = await post('/pacing/preview');
    const data = payload.data as { jeda: unknown[] };

    expect(status).toBe(200);
    expect(data.jeda.length).toBeGreaterThan(0);
  });

  test('typing mengikuti panjang pesan', async () => {
    fakeEnv(ENV);

    const { payload } = await post('/typing/preview', { lengths: [60, 150, 5000] });
    const data = payload.data as { durasi: { detik: number | null }[] };

    // 60 ÷ 15 = 4 detik; 150 ÷ 15 = 10 detik; sisanya berhenti di batas 20.
    expect(data.durasi.map((item) => item.detik)).toEqual([4, 10, 20]);
  });

  test('throttle menjadwalkan satu jendela per kelompok', async () => {
    fakeEnv({});

    const { payload } = await post('/throttle/preview', {
      throttle: { max: 2, window: 30 },
      count: 5,
    });
    const data = payload.data as { jadwal: { detik: number | null }[] };

    expect(data.jadwal.map((item) => item.detik)).toEqual([0, 0, 30, 30, 60]);
  });

  test('presence mengembalikan kosakata baku dan labelnya', async () => {
    fakeEnv({});

    const { status, payload } = await post('/presence', { state: 'audio', duration: 5 });
    const data = payload.data as Record<string, unknown>;

    expect(status).toBe(200);
    expect(data['keadaan']).toBe('recording');
    expect(data['label']).toBe('sedang merekam suara');
    expect(data['milidetik']).toBe(5000);
  });

  test('presence tanpa durasi ditolak sebagai 400 dengan pesan SDK', async () => {
    fakeEnv({});

    const { status, payload } = await post('/presence', { state: 'composing' });

    expect(status).toBe(400);
    expect(payload.message).toContain("kunci 'duration'");
  });

  test('nomor dinormalkan sekaligus menjadi WID', async () => {
    fakeEnv({});

    const { payload } = await post('/phone', { number: '0812-3456-7890' });
    const data = payload.data as Record<string, unknown>;

    expect(data['normalisasi']).toBe('6281234567890');
    expect(data['wid']).toBe('6281234567890@c.us');
    expect(data['terpakai']).toBe(true);
  });

  test('nomor tanpa angka ditandai tidak terpakai', async () => {
    fakeEnv({});

    const { payload } = await post('/phone', { number: 'abc' });
    const data = payload.data as Record<string, unknown>;

    expect(data['normalisasi']).toBe('');
    expect(data['terpakai']).toBe(false);
  });

  test('berkas diterjemahkan ke jenis dan ukuran yang benar', async () => {
    fakeEnv({});

    // Base64 dari "halo dunia".
    const { status, payload } = await post('/media', {
      payload: 'aGFsbyBkdW5pYQ==',
      filename: 'bukti.png',
    });
    const data = payload.data as Record<string, unknown>;

    expect(status).toBe(200);
    expect(data['jenis']).toBe('image/png');
    expect(data['namaBerkas']).toBe('bukti.png');
    expect(data['gambar']).toBe(true);
    expect(data['ukuran']).toBe(10);
    expect(data['melebihiBatas']).toBe(false);
  });

  test('berkas kosong ditolak sebagai 400', async () => {
    fakeEnv({});

    const { status, payload } = await post('/media', { payload: '   ' });

    expect(status).toBe(400);
    expect(payload.message).toContain('Isi berkas kosong');
  });
});

describe('Playground SIKUWA — pratinjau payload Fonnte', () => {
  test('seluruh batch dikemas ke satu field data', async () => {
    fakeEnv(ENV);

    const { status, payload } = await post('/plan/preview', {
      messages: [
        { destination: '081234567890', message: 'satu' },
        { destination: '081298765432', message: 'dua' },
      ],
    });
    const data = payload.data as {
      gateway: string;
      field: string;
      jumlahPesan: number;
      payload: string;
    };

    expect(status).toBe(200);
    expect(data.gateway).toBe('Fonnte');
    expect(data.jumlahPesan).toBe(2);
    expect(data.field).toBe('data');

    // `payload` adalah NILAI field `data`, bukan badan request utuh: badannya
    // form-urlencoded, dan JSON ini dikirim sebagai salah satu nilainya.
    const batch = JSON.parse(data.payload) as Array<Record<string, string>>;
    expect(batch).toHaveLength(2);
    // Tujuan diteruskan apa adanya, tanpa dinormalkan — persis seperti versi
    // PHP, yang hanya menormalkan di `sendMedia()` dan `sendPresence()`.
    expect(batch.map((line) => line['target'])).toEqual(['081234567890', '081298765432']);
    expect(batch.map((line) => line['message'])).toEqual(['satu', 'dua']);
    // Fonnte menerima `delay` sebagai string, satuannya detik.
    expect(batch.map((line) => line['delay'])).toEqual(['0', '30']);
  });

  test('jeda tiap pesan mengikuti siklus dari environment', async () => {
    fakeEnv(ENV);

    const { payload } = await post('/plan/preview', {
      messages: [
        { destination: '0811', message: 'a' },
        { destination: '0812', message: 'b' },
        { destination: '0813', message: 'c' },
      ],
    });
    const data = payload.data as { pesan: { delay: number | null }[] };

    // Siklus `0,30` dipakai bergiliran.
    expect(data.pesan.map((item) => item.delay)).toEqual([0, 30, 0]);
  });

  test('delay 0 dari pemanggil tidak tertimpa pacing', async () => {
    fakeEnv(ENV);

    const { payload } = await post('/plan/preview', {
      messages: [{ destination: '0811', message: 'a', delay: 0 }],
    });
    const data = payload.data as { pesan: { delay: number | null }[] };

    // `0` adalah perintah eksplisit "jangan tunggu" — berbeda dari kunci yang
    // tidak disebut sama sekali, yang berarti "ikut aturan pacing".
    expect(data.pesan[0]?.delay).toBe(0);
  });

  test('opsi pacing dari pemanggil menang atas environment', async () => {
    fakeEnv(ENV);

    const { payload } = await post('/plan/preview', {
      messages: [
        { destination: '0811', message: 'a' },
        { destination: '0812', message: 'b' },
      ],
      pacing: { cycle: '7' },
    });
    const data = payload.data as { pesan: { delay: number | null }[] };

    expect(data.pesan.map((item) => item.delay)).toEqual([7, 7]);
  });

  test('lama indikator dihitung per pesan, mengikuti panjangnya', async () => {
    fakeEnv(ENV);

    const { payload } = await post('/plan/preview', {
      messages: [
        { destination: '0811', message: 'x'.repeat(60) },
        { destination: '0812', message: 'x'.repeat(300) },
      ],
    });
    const data = payload.data as { pesan: { typing: number | null }[] };

    // Kecepatan bawaan 15 karakter/detik: 60 ÷ 15 = 4, dan 300 ÷ 15 = 20.
    expect(data.pesan.map((item) => item.typing)).toEqual([4, 20]);
  });

  test('tujuan berulang dilaporkan ke pemanggil', async () => {
    fakeEnv(ENV);

    const { payload } = await post('/plan/preview', {
      messages: [
        { destination: '0811', message: 'a' },
        { destination: '0811', message: 'b' },
        { destination: '0812', message: 'c' },
      ],
    });
    const data = payload.data as { tujuanBerulang: string[] };

    expect(data.tujuanBerulang).toEqual(['0811']);
  });

  test('daftar pesan bawaan dipakai bila pemanggil tidak mengirim', async () => {
    fakeEnv(ENV);

    const { status, payload } = await post('/plan/preview');
    const data = payload.data as { jumlahPesan: number; pesan: unknown[] };

    expect(status).toBe(200);
    expect(data.jumlahPesan).toBe(2);
    expect(data.pesan).toHaveLength(2);
  });

  test('pratinjau payload tidak pernah menyentuh jaringan', async () => {
    fakeEnv({ ...ENV, WHATSAPP_URL: 'https://harusnya-tidak-dipanggil.test/' });

    // Kalau jalur ini sampai mengirim, klien yang selalu gagal akan membuat
    // permintaannya berakhir 500 alih-alih 200.
    const { status } = await post('/plan/preview', {
      messages: [{ destination: '0811', message: 'a' }],
    });

    expect(status).toBe(200);
  });
});

describe('Playground SIKUWA — pendaftaran di aplikasi utama', () => {
  test('rute whatsapp terjangkau lewat /api/whatsapp', async () => {
    fakeEnv(ENV);

    const response = await app.request('/api/whatsapp/providers');

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { data: { daftar: string[] } };
    expect(payload.data.daftar).toContain('EvolutionAPI');
  });
});
