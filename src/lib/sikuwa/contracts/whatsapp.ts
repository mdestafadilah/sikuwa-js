import type { Session } from '../session';
import type { PacingSpec } from '../support/pacing';
import type { ThrottleSpec } from '../support/throttle';
import type { TypingSpec } from '../support/typing';

/**
 * Satu pesan yang dikirim pemanggil.
 *
 * Bentuknya sama di semua gateway — itulah yang membuat mengganti gateway,
 * atau membiarkan SDK memilihnya sendiri, tidak mengubah kode pemanggil.
 */
export interface OutgoingMessage {
  /** Nomor tujuan, boleh dalam format lokal maupun internasional. */
  destination: string;
  /** Isi pesan teks. */
  message?: string;
  /**
   * Jeda sebelum pesan dikirim, dalam detik.
   *
   * Bila diisi, nilainya **menang** atas pacing dan throttle: angka yang
   * disebut pemanggil selalu dihormati apa adanya, termasuk `0`.
   */
  delay?: string | number | null;
  /** Isi gambar: data URI, base64 telanjang, atau URL publik. */
  image?: string;
  /** Alias `image`, untuk pemanggil yang menyimpan berkasnya secara umum. */
  media?: string;
  /** Isi dokumen. */
  file?: string;
  /** Nama berkas yang akan dilihat penerima. */
  filename?: string;
  /** Teks yang menemani gambar atau dokumen. */
  caption?: string;
  /** Penimpaan pacing untuk panggilan ini saja. */
  pacing?: PacingSpec | null;
  /** Penimpaan typing untuk panggilan ini saja. */
  typing?: TypingSpec | null;
  /** Penimpaan throttle untuk panggilan ini saja. */
  throttle?: ThrottleSpec | null;
  [key: string]: unknown;
}

/**
 * Amplop pengiriman massal.
 *
 * Dipakai ketika pemanggil ingin menimpakan pacing, typing, atau throttle
 * untuk satu panggilan saja tanpa mengubah konfigurasi yang sudah terpasang.
 */
export interface MessageEnvelope {
  messages: OutgoingMessage[];
  pacing?: PacingSpec | null;
  typing?: TypingSpec | null;
  throttle?: ThrottleSpec | null;
}

/** Seluruh bentuk yang diterima `sendMessage()`. */
export type MessageInput = OutgoingMessage | OutgoingMessage[] | MessageEnvelope | string;

/** Permintaan indikator "sedang mengetik". */
export interface TypingRequest {
  destination: string;
  /** `composing` (bawaan), `paused`, atau `recording`; alias gateway juga diterima. */
  state?: string;
  /** Lama indikator ditampilkan, detik. Wajib saat menampilkan indikator. */
  duration?: string | number | null;
  [key: string]: unknown;
}

/**
 * Antarmuka tunggal yang harus dipenuhi setiap gateway WhatsApp.
 *
 * Semua provider memakai bentuk pesan yang sama supaya mengganti gateway —
 * atau membiarkan SDK memilihnya sendiri — tidak mengubah kode pemanggil.
 *
 * ## Sinkron menjadi asinkron
 *
 * Versi PHP mengembalikan `string` dari setiap method kirim, karena Guzzle
 * menunggu balasan sebelum kembali. Di JavaScript setiap panggilan jaringan
 * adalah Promise, jadi seluruh tanda tangan di sini mengembalikan `Promise`.
 * Ini perubahan yang tidak bisa dihindari — dan justru kesempatan: pengiriman
 * beruntun dengan pacing tidak lagi menahan seluruh proses pemanggil.
 *
 * ## Sesi
 *
 * Sesi WhatsApp juga seragam: `createSession()`, `checkSession()`, dan
 * `showQr()` selalu mengembalikan `Session`, apa pun gateway-nya — walaupun
 * tiap gateway menyebutnya berbeda (OpenWA "session", ApiMe dan Evolution API
 * "instance", wuzapi dan Fonnte "device").
 */
export interface Whatsapp {
  /**
   * Kirim satu pesan, atau beberapa sekaligus.
   *
   * Mengembalikan detail hasil yang siap dicatat ke log. Setiap provider
   * mengawalinya dengan `"Sukses"` supaya pemanggil bisa menentukan level log
   * tanpa tahu gateway mana yang dipakai.
   *
   * Melempar `WhatsappException` bila pesan gagal dikirim. Pakai `notify()`
   * pada `Client` kalau pemanggil lebih suka menerima string alih-alih
   * exception. Khusus 429 dan 503, provider mencoba ulang sendiri sebanyak
   * `WHATSAPP_RETRIES` bila gateway menyertakan `Retry-After`; exception hanya
   * dilempar setelah jatah itu habis.
   */
  sendMessage(message: MessageInput): Promise<string>;

  /**
   * Kirim satu gambar.
   *
   * Yang menentukan sebuah berkas dikirim sebagai gambar atau dokumen adalah
   * **jenis berkasnya**, bukan method yang dipanggil — jadi `sendImage()`
   * dengan PDF tetap terkirim sebagai dokumen, dan sebaliknya.
   */
  sendImage(message: OutgoingMessage): Promise<string>;

  /**
   * Kirim satu berkas/dokumen (PDF, DOCX, XLSX, ZIP, dan seterusnya).
   *
   * `filename` lebih penting di sini daripada pada gambar: ia menentukan nama
   * yang dilihat penerima sekaligus jenis berkasnya, dan beberapa gateway
   * menolak dokumen tanpa nama.
   */
  sendFile(message: OutgoingMessage): Promise<string>;

  /**
   * Tampilkan (atau hapus) indikator "sedang mengetik" — supaya balasan bot
   * tidak muncul seketika seperti mesin.
   *
   * `duration` wajib diisi saat menampilkan indikator. Fonnte menuntutnya di
   * sisi server; Evolution API menahan indikator selama `duration` lalu
   * menghapusnya sendiri — dan panggilan ini ikut menunggu selama itu.
   */
  sendTyping(message: TypingRequest): Promise<string>;

  /**
   * Buat sesi/instance baru di gateway.
   *
   * Nama sesi diambil dari `options` bila ada, selain itu dari konfigurasi yang
   * sudah terpasang — `WHATSAPP_SESSION_<Provider>` dulu, baru
   * `WHATSAPP_SESSION`, dan `WHATSAPP_INSTANCE_<Provider>` dulu, baru
   * `WHATSAPP_INSTANCE`.
   *
   * Sesi yang baru dibuat biasanya belum tersambung: pindai QR-nya, lalu pantau
   * dengan `checkSession()`.
   */
  createSession(options?: Record<string, unknown>): Promise<Session>;

  /** Baca keadaan sesi yang sudah ada. */
  checkSession(id?: string | null): Promise<Session>;

  /**
   * Ambil QR milik sesi yang sudah ada, untuk dipindai.
   *
   * Dipanggil setelah `createSession()` atau `checkSession()` menunjukkan sesi
   * belum tersambung. Mengembalikan `Session` yang sama, dengan `qr` terisi
   * data URI PNG.
   */
  showQr(id?: string | null): Promise<Session>;

  /** Nama gateway, dipakai untuk memilih token dan menandai baris log. */
  getProvider(): string;

  /** Token efektif: token eksplisit bila ada, selainnya dari environment. */
  getToken(): string;
}
