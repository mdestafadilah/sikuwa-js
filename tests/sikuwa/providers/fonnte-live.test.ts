import { afterAll, describe, expect, test } from 'bun:test';
import { Fonnte } from '../../../src/lib/sikuwa/providers/fonnte/fonnte';

/**
 * Uji integrasi Fonnte terhadap server HTTP sungguhan.
 *
 * Test lain memakai klien HTTP palsu, dan justru karena itu mereka tidak bisa
 * membuktikan satu hal pun tentang perilaku runtime: bagaimana `URLSearchParams`
 * di-encode, apakah `boundary` multipart benar, dan apakah byte berkasnya utuh
 * setelah melewati `Blob` → `FormData` → HTTP → `FormData` lagi. Ketiganya
 * dikerjakan oleh `fetch` bawaan, bukan oleh SDK — jadi mock yang menggantinya
 * hanya membuktikan bahwa SDK memanggil mock dengan benar.
 *
 * Di sini Fonnte diarahkan ke `Bun.serve` lokal dan `fetch` yang berjalan
 * adalah `fetch` sungguhan. Yang diperiksa adalah apa yang benar-benar sampai
 * di sisi server.
 */

interface Captured {
  method: string;
  path: string;
  authorization: string;
  contentType: string;
  /** Body mentah untuk request form-encoded atau JSON. */
  body: string;
  form: Record<string, string>;
  multipart: Array<[string, FormDataEntryValue]>;
}

const captured: Captured[] = [];

/**
 * Bila true, server menjawab seperti Fonnte saat menolak: HTTP 200 dengan
 * `status: false`. Dipasang sebagai saklar, bukan server kedua, supaya seluruh
 * berkas hanya memakai satu listener dan urutan test tidak jadi soal.
 */
let refuse = false;

const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const url = new URL(request.url);
    const contentType = request.headers.get('content-type') ?? '';

    let body = '';
    let form: Record<string, string> = {};
    let multipart: Array<[string, FormDataEntryValue]> = [];

    if (contentType.includes('multipart/form-data')) {
      // Sengaja dibaca dengan `formData()` milik runtime, bukan diurai tangan:
      // inilah yang membuktikan body-nya benar-benar sah menurut standar.
      multipart = [...(await request.formData()).entries()];
    } else {
      body = await request.text();

      if (contentType.includes('application/x-www-form-urlencoded')) {
        form = Object.fromEntries(new URLSearchParams(body).entries());
      }
    }

    captured.push({
      method: request.method,
      path: url.pathname,
      authorization: request.headers.get('authorization') ?? '',
      contentType,
      body,
      form,
      multipart,
    });

    if (refuse) {
      return Response.json({ status: false, reason: 'token tidak valid' });
    }

    // Amplop Fonnte: selalu HTTP 200, keberhasilan ada di field `status`.
    if (url.pathname === '/qr') {
      return Response.json({ status: true, device: '62811', url: 'iVBORw0KGgo=' });
    }

    return Response.json({ status: true, detail: 'terkirim' });
  },
});

const base = `http://127.0.0.1:${server.port}`;

/** Provider yang diarahkan ke server lokal ini, bukan ke api.fonnte.com. */
function provider(): Fonnte {
  return new Fonnte({ token: 'tok', url: `${base}/send` });
}

function last(): Captured {
  const request = captured.at(-1);

  if (request === undefined) throw new Error('server tidak menerima request apa pun');

  return request;
}

afterAll(() => {
  server.stop(true);
});

describe('Fonnte lewat HTTP sungguhan', () => {
  test('pesan tunggal sampai sebagai form-encoded dengan field data', async () => {
    const result = await provider().sendMessage({
      destination: '081234567890',
      message: 'halo dari test integrasi',
    });

    expect(result).toBe('Sukses: terkirim');

    const request = last();
    expect(request.method).toBe('POST');
    expect(request.path).toBe('/send');
    expect(request.authorization).toBe('tok');
    expect(request.contentType).toContain('application/x-www-form-urlencoded');

    // Yang dibaca Fonnte adalah JSON di dalam field `data`.
    expect(JSON.parse(request.form['data'] ?? '[]')).toEqual([
      { target: '081234567890', message: 'halo dari test integrasi', delay: '2' },
    ]);
  });

  test('batch dikirim sebagai satu request berisi semua pesan', async () => {
    const before = captured.length;

    await provider().sendMessage([
      { destination: '0811', message: 'a' },
      { destination: '0822', message: 'b', delay: 5 },
    ]);

    expect(captured.length).toBe(before + 1);
    expect(JSON.parse(last().form['data'] ?? '[]')).toEqual([
      { target: '0811', message: 'a', delay: '2' },
      { target: '0822', message: 'b', delay: '5' },
    ]);
  });

  /**
   * Bukti yang paling penting: byte berkas utuh setelah melewati
   * `File.bytes()` → `Blob` → `FormData` → HTTP → `formData()`.
   *
   * Dipakai 256 byte yang tidak semuanya teks sah, supaya kerusakan encoding
   * apa pun langsung terlihat — berkas teks biasa bisa lolos walau jalurnya
   * salah.
   */
  test('berkas biner utuh sampai ke server, tidak rusak oleh encoding', async () => {
    const original = new Uint8Array(256);
    for (let i = 0; i < 256; i++) original[i] = i;

    const base64 = btoa(String.fromCharCode(...original));
    const image = `data:application/octet-stream;base64,${base64}`;

    const result = await provider().sendImage({
      destination: '0811',
      image,
      caption: 'Bukti transfer',
    });

    expect(result).toBe('Sukses: terkirim');

    const request = last();
    expect(request.path).toBe('/send');
    expect(request.contentType).toContain('multipart/form-data');

    const names = request.multipart.map(([name]) => name);
    expect(names).toEqual(['target', 'filename', 'message', 'file']);

    const byName = new Map(request.multipart);
    expect(byName.get('target')).toBe('62811');
    expect(byName.get('message')).toBe('Bukti transfer');

    const uploaded = byName.get('file');
    expect(uploaded).toBeInstanceOf(File);
    expect((uploaded as File).name).toBe('lampiran.bin');
    expect((uploaded as File).type).toBe('application/octet-stream');

    const received = new Uint8Array(await (uploaded as File).arrayBuffer());
    expect(received.length).toBe(256);
    expect([...received]).toEqual([...original]);
  });

  test('indikator ketik sampai sebagai form-encoded ke /typing', async () => {
    const result = await provider().sendTyping({
      destination: '0812',
      state: 'composing',
      duration: 4,
    });

    expect(result).toBe('Sukses, indikator sedang mengetik dikirim ke 62812');

    const request = last();
    expect(request.method).toBe('POST');
    // Device API diturunkan dari URL pengiriman, tanpa sufiks `/send`.
    expect(request.path).toBe('/typing');
    expect(request.form).toEqual({ target: '62812', duration: '4' });
  });

  test('QR diambil dari host yang sama dan dirangkai menjadi data URI', async () => {
    const session = await provider().showQr('0812');

    expect(last().path).toBe('/qr');
    expect(JSON.parse(last().body)).toEqual({ type: 'qr', whatsapp: '62812' });
    expect(session.qr).toBe('data:image/png;base64,iVBORw0KGgo=');
    expect(session.status).toBe('qr_ready');
  });

  test('penolakan Fonnte pada HTTP 200 tetap menjadi exception', async () => {
    refuse = true;

    try {
      await expect(
        provider().sendMessage({ destination: '0811', message: 'a' }),
      ).rejects.toThrow('token tidak valid');

      // Yang benar-benar diperiksa: kegagalannya datang dari amplop body,
      // bukan dari status HTTP — Fonnte membalas 200 di kedua keadaan.
      expect(last().path).toBe('/send');
    } finally {
      refuse = false;
    }
  });
});
