import type { Config, ConfigOptions } from '../../config';
import type { MessageInput } from '../../contracts/whatsapp';
import { ConfigurationException } from '../../exceptions';
import type { HttpExecutor } from '../../http/http-executor';
import { toScalarString } from '../../internal/scalar';
import { Session } from '../../session';
import type { File } from '../../support/file';
import { PhoneNumber } from '../../support/phone-number';
import type { Presence } from '../../support/presence';
import { AbstractProvider } from '../abstract-provider';
import { OPENWA_DEFAULT_URL, OPENWA_NAME } from './constants';
import { OpenWABulkMessage } from './openwa-bulk-message';
import type { OpenWAMessage } from './openwa-message';
import { OpenWASession } from './openwa-session';
import { OpenWAShowQr } from './openwa-show-qr';

/**
 * Gateway OpenWA (https://github.com/rmyndharis/OpenWA), WhatsApp self-hosted
 * berbasis Node.js.
 *
 * Konfigurasi:
 *   WHATSAPP_PROVIDER = OpenWA
 *   WHATSAPP_TOKEN    = API key OpenWA, dikirim sebagai header `X-API-Key`
 *   WHATSAPP_URL_OpenWA = base URL instance, mis. https://v15.example.com
 *                         (`WHATSAPP_URL` juga dibaca sebagai fallback umum)
 *   WHATSAPP_SESSION  = id session yang sudah di-start dan tersambung
 *                       (`WHATSAPP_SESSION_OpenWA` menang atasnya, sehingga
 *                       OpenWA bisa memakai sesi sendiri tanpa mengganggu
 *                       gateway lain)
 *
 * ## Satu endpoint untuk satu pesan, satu untuk banyak
 *
 * Satu pesan dikirim ke `messages/send-text` (sinkron, balasannya `messageId`),
 * lebih dari satu ke `messages/send-bulk` (asinkron, balasannya `batchId`).
 * Itu sebabnya provider ini **tidak** memakai `sendIndividually()` seperti lima
 * gateway self-hosted lainnya: yang menentukan jalurnya bukan jumlah pesan yang
 * diminta pemanggil, melainkan endpoint mana yang menerima batch.
 *
 * Karena seluruh batch masuk dalam satu request, SDK tidak punya kesempatan
 * menyisipkan indikator ketik di antara pesan — lihat `sendMessage()`.
 */
export class OpenWA extends AbstractProvider {
  static readonly NAME = OPENWA_NAME;

  static readonly DEFAULT_URL = OPENWA_DEFAULT_URL;

  private readonly baseUrl: string;

  private readonly sessionId: string;

  constructor(options?: ConfigOptions | Config | null, http?: HttpExecutor | null) {
    super(options, http);

    this.baseUrl = this.config.url(OpenWA.DEFAULT_URL, OpenWA.NAME);
    // Nama provider ikut diberikan supaya `WHATSAPP_SESSION_OpenWA`
    // didahulukan — lihat `Config.session()`.
    this.sessionId = this.config.session(OpenWA.NAME);
  }

  getProvider(): string {
    return OpenWA.NAME;
  }

  getSessionId(): string {
    return this.sessionId;
  }

  protected authHeaders(): Record<string, string> {
    return { 'X-API-Key': this.getToken() };
  }

  /**
   * Buat sesi baru: `POST /api/sessions`.
   *
   * Sesi baru berstatus `INITIALIZING`, jadi belum bisa dipakai mengirim.
   * Ambil QR-nya lewat `showQr()`, lalu pantau dengan `checkSession()`.
   *
   * Kunci `options` yang dikenali: `id`, `name`, `config`.
   */
  async createSession(options: Record<string, unknown> = {}): Promise<Session> {
    const payload = OpenWASession.payload(options, this.sessionId);
    const body = await this.postJson(`${this.baseUrl}/api/sessions`, payload);

    return OpenWASession.fromResponse(body, String(payload['id'] ?? ''));
  }

  /**
   * Baca keadaan sesi: `GET /api/sessions/{id}`.
   *
   * @param id Sesi yang diperiksa; default dari `WHATSAPP_SESSION`.
   */
  async checkSession(id?: string | null): Promise<Session> {
    const sessionId = this.requireConfigured(id ?? this.sessionId, 'WHATSAPP_SESSION');

    return OpenWASession.fromResponse(
      await this.getJson(`${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}`),
      sessionId,
    );
  }

  /**
   * Ambil QR sesi: `GET /api/sessions/{id}/qr`.
   *
   * Hanya menjawab saat sesi sedang menunggu dipindai. Sesi yang belum
   * mencapai `qr_ready` — termasuk yang sudah tersambung, dan yang sedang
   * menyambung ulang — ditolak dengan HTTP 400, sedangkan API key yang bukan
   * kunci berperan operator ditolak dengan HTTP 403.
   */
  async showQr(id?: string | null): Promise<Session> {
    const sessionId = this.requireConfigured(id ?? this.sessionId, 'WHATSAPP_SESSION');

    return OpenWAShowQr.fromResponse(
      await this.getJson(
        `${this.baseUrl}/api/sessions/${encodeURIComponent(sessionId)}/qr`,
      ),
      sessionId,
    );
  }

  /**
   * Kirim pesan lewat OpenWA.
   *
   * Jeda antar pesan di `send-bulk` diisi dari `delay` pesan **kedua**, atau
   * dari `delay` pesan pertama bila batch-nya cuma satu pesan, lalu jatuh ke
   * pacing (`WHATSAPP_PACING_*`). OpenWA hanya menerima satu angka jeda untuk
   * seluruh batch, dan jeda pesan kedua yang paling mewakili: jeda pertama
   * yang benar-benar terasa di antara dua pesan.
   *
   * OpenWA juga menambahkan pengacakan sendiri di sisinya (`randomizeDelay`),
   * jadi jeda yang diminta di sini adalah nilai tengahnya, bukan angka pasti.
   */
  async sendMessage(message: MessageInput): Promise<string> {
    const items = this.plan(message);

    if (items.length === 0) {
      return 'Tidak ada pesan untuk dikirim';
    }

    this.requireConfigured(this.sessionId, 'WHATSAPP_SESSION');

    const delay = items[1]?.delay ?? items[0]?.delay ?? OpenWABulkMessage.DEFAULT_DELAY;
    const bulk = this.compose(() => new OpenWABulkMessage(items, delay));

    if (bulk.count() === 0) {
      return 'Tidak ada pesan untuk dikirim';
    }

    // OpenWA menerima seluruh batch dalam satu request, jadi SDK tidak punya
    // kesempatan menyisipkan indikator di antara pesan. Yang bisa dilakukan
    // adalah memunculkannya untuk tujuan pesan pertama: memunculkan untuk
    // semua tujuan sekaligus justru membuat penerima terakhir melihat "sedang
    // mengetik" lalu diam lama sebelum pesannya datang, dan itu lebih buruk
    // daripada tanpa indikator.
    await this.announceTyping(items[0] ?? null);

    const first = bulk.first();

    return bulk.count() === 1 && first !== null
      ? this.sendText(first)
      : this.sendBulk(bulk);
  }

  /**
   * Kirim satu berkas lewat OpenWA.
   *
   * Ada dua endpoint terpisah — `send-image` dan `send-document` — dengan
   * bentuk body yang sama; yang menentukan adalah jenis berkasnya, bukan nama
   * method yang dipanggil pemanggil.
   *
   * OpenWA menerima base64 MENTAH dan mengirim `mimetype` di kolom sendiri,
   * jadi awalan `data:…;base64,` justru harus dibuang — itulah gunanya
   * `File.base64()` alih-alih `File.dataUri()`. Kalau sumbernya URL publik,
   * yang dikirim cukup `url` saja supaya server OpenWA yang mengunduh, bukan
   * keduanya sekaligus.
   */
  protected async sendMedia(
    destination: string,
    file: File,
    caption: string,
  ): Promise<string> {
    this.requireConfigured(this.sessionId, 'WHATSAPP_SESSION');

    // OpenWA menolak nomor mentah: `chatId` wajib berupa JID lengkap.
    const chatId = PhoneNumber.toWid(destination);

    // `toWid()` membentuk "@c.us" begitu nomornya kosong, dan itu akan
    // ditolak server dengan pesan yang tidak menjelaskan apa-apa.
    if (chatId.startsWith('@')) {
      throw new ConfigurationException(`Nomor tujuan '${destination}' tidak valid`);
    }

    const payload: Record<string, unknown> = {
      chatId,
      mimetype: file.mime,
      filename: file.filename,
    };

    if (caption !== '') {
      payload['caption'] = caption;
    }

    if (file.isUrl()) {
      payload['url'] = file.payload;
    } else {
      payload['base64'] = file.base64();
    }

    const body = await this.postJson(
      this.sessionUrl(file.isImage() ? 'messages/send-image' : 'messages/send-document'),
      payload,
    );

    return `Sukses, messageId: ${toScalarString(body['messageId'] ?? '-')}`;
  }

  /**
   * Tampilkan atau hapus indikator "sedang mengetik": `POST .../chats/typing`.
   *
   * OpenWA memakai kata yang berbeda dari kosakata baku di sini — `typing`
   * untuk mengetik, `recording` untuk merekam suara — jadi penerjemahannya
   * dilakukan di tempat ini, bukan di `Presence`, supaya kosakata bakunya
   * tetap satu untuk semua gateway.
   *
   * `duration` tidak ikut dikirim: OpenWA menyimpan statusnya sampai dihapus
   * dengan `paused`, atau sampai ada pesan yang benar-benar terkirim. Karena
   * itu `presenceBlocks()` tidak diubah — SDK tetap menghabiskan durasinya
   * sendiri lewat `announceTyping()`.
   */
  protected async sendPresence(
    destination: string,
    presence: Presence,
  ): Promise<string> {
    this.requireConfigured(this.sessionId, 'WHATSAPP_SESSION');

    // Sama seperti pengiriman berkas: `chatId` wajib berupa JID lengkap, dan
    // `toWid()` membentuk "@c.us" begitu nomornya kosong.
    const chatId = PhoneNumber.toWid(destination);

    if (chatId.startsWith('@')) {
      throw new ConfigurationException(`Nomor tujuan '${destination}' tidak valid`);
    }

    const state = presence.isRecording()
      ? 'recording'
      : presence.isPaused()
        ? 'paused'
        : 'typing';

    await this.postJson(this.sessionUrl('chats/typing'), { chatId, state });

    return this.presenceResult(presence, chatId);
  }

  /** `POST /api/sessions/{sessionId}/messages/send-text` */
  private async sendText(message: OpenWAMessage): Promise<string> {
    const body = await this.postJson(this.sessionUrl('messages/send-text'), message.toArray());

    return `Sukses, messageId: ${toScalarString(body['messageId'] ?? '-')}`;
  }

  /** `POST /api/sessions/{sessionId}/messages/send-bulk` */
  private async sendBulk(bulk: OpenWABulkMessage): Promise<string> {
    const body = await this.postJson(this.sessionUrl('messages/send-bulk'), bulk.toArray());

    // Gateway boleh melaporkan jumlah yang berbeda dari yang dikirim — mis.
    // bila ia sudah membuang tujuan duplikat. Angka dari gateway yang dipakai,
    // dan jumlah lokal hanya jadi cadangan saat field-nya tidak ada.
    const total = body['totalMessages'] ?? bulk.count();
    const batchId = body['batchId'] ?? '-';

    return `Batch diterima (${toScalarString(total)} pesan), batchId: ${toScalarString(batchId)}`;
  }

  /** URL endpoint yang bernaung di bawah sesi, mis. `messages/send-text`. */
  private sessionUrl(path: string): string {
    return `${this.baseUrl}/api/sessions/${encodeURIComponent(this.sessionId)}/${path}`;
  }
}
