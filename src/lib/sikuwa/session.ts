import type { JsonObject } from './support/envelope';
import { Qr } from './support/qr';

/** Isi satu keadaan sesi. Semua kunci opsional kecuali `provider`. */
export interface SessionOptions {
  /** Nama gateway, mis. `OpenWA`. */
  provider: string;
  /** Id sesi menurut gateway. Bisa kosong kalau gateway membuatnya sendiri. */
  id?: string;
  /** Status apa adanya dari gateway, huruf besar dinormalkan per gateway. */
  status?: string;
  /** Apakah sesi siap mengirim pesan. */
  connected?: boolean;
  /** QR sebagai data URI, bila ada. */
  qr?: string;
  /**
   * Kredensial sesi yang baru diterbitkan gateway, bila ada — mis. token
   * perangkat Fonnte atau `hash.apikey` Evolution API.
   */
  token?: string;
  /** Nomor yang tersambung, bila ada. */
  phoneNumber?: string;
  /** Nama profil WhatsApp, bila ada. */
  profileName?: string;
  /** Amplop asli dari gateway. */
  raw?: JsonObject;
}

/**
 * Keadaan satu sesi WhatsApp, dengan bentuk yang sama untuk semua gateway.
 *
 * Gateway menyebutnya berbeda-beda — OpenWA "session", ApiMe dan Evolution API
 * "instance", wuzapi dan Fonnte "device" — tetapi pemanggil selalu ingin tahu
 * hal yang sama: sesi mana ini, sudah tersambung atau belum, dan kalau belum,
 * di mana QR-nya. Itulah isi objek ini.
 *
 * Nilai yang tidak disediakan gateway dibiarkan kosong, bukan ditebak. Yang
 * paling mentah selalu bisa dilihat di {@link raw} kalau pemanggil butuh field
 * khusus gateway.
 *
 * Sesi yang baru dibuat biasanya menerbitkan kredensialnya sendiri — lihat
 * {@link token}. Simpan nilainya, karena itulah yang dipakai untuk mengirim
 * pesan lewat sesi tersebut.
 */
export class Session {
  /** Nama gateway, mis. `OpenWA`. */
  readonly provider: string;
  /** Id sesi menurut gateway. */
  readonly id: string;
  /** Status apa adanya dari gateway. */
  readonly status: string;
  /** Apakah sesi siap mengirim pesan. */
  readonly connected: boolean;
  /**
   * QR sebagai data URI, bila ada.
   *
   * Selalu data URI penuh atau string kosong — gateway yang mengirim base64
   * telanjang (Fonnte) dibungkus lebih dulu oleh `Qr.dataUri()`, jadi nilainya
   * bisa langsung dipasang di atribut `src`.
   */
  readonly qr: string;
  /** Kredensial sesi yang baru diterbitkan gateway, bila ada. */
  readonly token: string;
  /** Nomor yang tersambung, bila ada. */
  readonly phoneNumber: string;
  /** Nama profil WhatsApp, bila ada. */
  readonly profileName: string;
  /** Amplop asli dari gateway. */
  readonly raw: JsonObject;

  constructor(options: SessionOptions) {
    this.provider = options.provider;
    this.id = options.id ?? '';
    this.status = options.status ?? '';
    this.connected = options.connected ?? false;
    this.qr = options.qr ?? '';
    this.token = options.token ?? '';
    this.phoneNumber = options.phoneNumber ?? '';
    this.profileName = options.profileName ?? '';
    this.raw = options.raw ?? {};
  }

  /** Apakah sesi siap dipakai mengirim pesan. */
  isConnected(): boolean {
    return this.connected;
  }

  /** Apakah gateway menyediakan QR untuk dipindai. */
  hasQr(): boolean {
    return this.qr !== '';
  }

  /**
   * QR sebagai data URI — siap dipasang di atribut `src`.
   *
   * Sama dengan {@link qr}; namanya dibuat eksplisit supaya maksud pemakaiannya
   * terbaca di templat.
   */
  qrImage(): string {
    return this.qr;
  }

  /**
   * QR sebagai base64 murni, tanpa awalan `data:image/png;base64,`.
   *
   * Untuk pemanggil yang tidak ingin data URI — mis. menyimpan gambarnya
   * sendiri atau mengirimkannya sebagai JSON ke klien lain.
   */
  qrBase64(): string {
    return Qr.base64(this.qr);
  }

  /**
   * QR sebagai tag `<img>` siap cetak.
   *
   * Mengembalikan string kosong kalau tidak ada QR, sehingga pemanggil bisa
   * mencetaknya tanpa memeriksa {@link hasQr} lebih dulu.
   */
  qrTag(alt = 'QR WhatsApp', size = 260): string {
    if (!this.hasQr()) return '';

    return `<img src="${this.qr}" alt="${escapeHtml(alt)}" width="${size}" height="${size}">`;
  }

  /**
   * Bentuk yang aman disimpan atau dikirim sebagai JSON.
   *
   * `raw` dan `token` sengaja tidak ikut. `raw` bisa besar dan bentuknya
   * berbeda tiap gateway; `token` adalah kredensial, dan keluaran method ini
   * biasanya berakhir di log atau response HTTP. Keduanya tetap tersedia lewat
   * propertinya masing-masing.
   */
  toArray(): {
    provider: string;
    id: string;
    status: string;
    connected: boolean;
    qr: string;
    phoneNumber: string;
    profileName: string;
  } {
    return {
      provider: this.provider,
      id: this.id,
      status: this.status,
      connected: this.connected,
      qr: this.qr,
      phoneNumber: this.phoneNumber,
      profileName: this.profileName,
    };
  }

  toJson(): string {
    return JSON.stringify(this.toArray());
  }

  /** Ringkasan siap catat ke log, mis. `"OpenWA: CONNECTED (sess-1)"`. */
  toString(): string {
    const status = this.status !== '' ? this.status : this.connected ? 'connected' : 'unknown';
    const id = this.id !== '' ? ` (${this.id})` : '';

    return `${this.provider}: ${status}${id}`;
  }
}

/** `htmlspecialchars($alt, ENT_QUOTES)` PHP. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
