import type { Config, ConfigOptions } from '../../config';
import type { MessageInput } from '../../contracts/whatsapp';
import { ConfigurationException } from '../../exceptions';
import type { HttpExecutor, MultipartPart } from '../../http/http-executor';
import { isArrayLike, toScalarString } from '../../internal/scalar';
import { Session } from '../../session';
import type { JsonObject } from '../../support/envelope';
import type { File } from '../../support/file';
import type { Presence } from '../../support/presence';
import {
  AbstractProvider,
  type PlannedMessage,
  type PreparedMessage,
} from '../abstract-provider';
import { APIME_DEFAULT_URL, APIME_NAME } from './constants';
import { ApiMeMessage } from './apime-message';
import { ApiMeSession } from './apime-session';
import { ApiMeShowQr } from './apime-show-qr';

/**
 * Gateway ApiMe (https://github.com/open-apime/apime), WhatsApp self-hosted
 * berbasis Go + WhatsMeow.
 *
 * Konfigurasi:
 *   WHATSAPP_PROVIDER = ApiMe
 *   WHATSAPP_TOKEN    = instance token (header `Authorization: Bearer ...`)
 *   WHATSAPP_URL_ApiMe = base URL instance, mis. https://v14.example.com
 *                       (`WHATSAPP_URL` juga dibaca sebagai fallback umum)
 *   WHATSAPP_INSTANCE = UUID instance yang sudah tersambung
 *                       (`WHATSAPP_INSTANCE_ApiMe` menang atasnya, sehingga
 *                       ApiMe dan Evolution API bisa memakai instance berbeda)
 *
 * ## Token yang mudah tertukar
 *
 * ApiMe menuntut token **ber-scope instance**. Token user (JWT login) maupun
 * API token global ditolak dengan HTTP 403 oleh endpoint pengiriman. Ambil
 * tokennya saat membuat instance, atau putar lewat
 * `POST /api/instances/{id}/token/rotate`.
 *
 * Karena itu `createSession()` biasanya dijalankan sekali dari dashboard atau
 * skrip admin — bukan dari jalur notifikasi — sebab endpoint pembuatan
 * instance justru menolak token instance dan menuntut token user.
 *
 * ## Bentuk pengiriman
 *
 * ApiMe tidak punya endpoint batch, jadi beberapa pesan dikirim satu per satu
 * secara berurutan lewat `sendIndividually()`. Mengirim banyak pesan akan
 * menahan pemanggil selama total jedanya.
 */
export class ApiMe extends AbstractProvider {
  static readonly NAME = APIME_NAME;

  static readonly DEFAULT_URL = APIME_DEFAULT_URL;

  private readonly baseUrl: string;

  private readonly instanceId: string;

  constructor(options?: ConfigOptions | Config | null, http?: HttpExecutor | null) {
    super(options, http);

    const url = this.config.url(ApiMe.DEFAULT_URL, ApiMe.NAME);

    // Terima "http://host:8080" maupun "http://host:8080/api" tanpa menjadi
    // "/api/api" — seluruh path di kelas ini sudah menuliskan `/api` sendiri.
    this.baseUrl = url.replace(/\/api$/, '');

    // Nama provider ikut diberikan supaya `WHATSAPP_INSTANCE_ApiMe`
    // didahulukan — lihat `Config.instance()`.
    this.instanceId = this.config.instance(ApiMe.NAME);
  }

  getProvider(): string {
    return ApiMe.NAME;
  }

  getInstanceId(): string {
    return this.instanceId;
  }

  protected authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.getToken()}` };
  }

  /**
   * Buat instance baru: `POST /api/instances`.
   *
   * Endpoint ini menuntut token **user** (JWT) atau API token. Token
   * ber-scope instance — yang dipakai untuk mengirim pesan — ditolak dengan
   * HTTP 403.
   *
   * Kunci `options` yang dikenali: `name`, `webhook_url`, `webhook_secret`.
   */
  async createSession(options: Record<string, unknown> = {}): Promise<Session> {
    const payload = ApiMeSession.payload(options, this.instanceId);
    const body = await this.postJson(`${this.baseUrl}/api/instances`, payload);

    return ApiMeSession.fromResponse(body, toScalarString(payload['name'] ?? ''));
  }

  /**
   * Baca keadaan instance: `GET /api/instances/{id}`.
   *
   * @param id Instance yang diperiksa; default dari `WHATSAPP_INSTANCE`.
   */
  async checkSession(id?: string | null): Promise<Session> {
    const instanceId = this.requireConfigured(id ?? this.instanceId, 'WHATSAPP_INSTANCE');

    return ApiMeSession.fromResponse(
      await this.getJson(`${this.baseUrl}/api/instances/${encodeURIComponent(instanceId)}`),
      instanceId,
    );
  }

  /**
   * Ambil QR instance: `GET /api/instances/{id}/qr`.
   *
   * Inilah QR yang dipindai untuk menyambungkan instance yang baru dibuat.
   * ApiMe tidak mendokumentasikan skema balasannya, jadi pembacaannya
   * diserahkan ke `ApiMeShowQr`.
   */
  async showQr(id?: string | null): Promise<Session> {
    const instanceId = this.requireConfigured(id ?? this.instanceId, 'WHATSAPP_INSTANCE');

    return ApiMeShowQr.fromResponse(
      await this.getJson(
        `${this.baseUrl}/api/instances/${encodeURIComponent(instanceId)}/qr`,
      ),
      instanceId,
    );
  }

  /**
   * Kirim pesan lewat ApiMe.
   *
   * Jeda antar pesan dihormati lewat kunci `delay` atau, bila tidak diisi,
   * lewat pacing (`WHATSAPP_PACING_*`).
   */
  async sendMessage(message: MessageInput): Promise<string> {
    return this.sendIndividually(
      message,
      (items) => this.build(items),
      (msg) => this.sendText(msg),
      (msg) => msg.to,
    );
  }

  /**
   * Susun item `plan()` menjadi pesan ApiMe.
   *
   * Instance diperiksa di sini, bukan di `sendMessage()`, supaya jalurnya sama
   * dengan provider lain: `sendIndividually()` memanggil `build()` tepat sekali
   * sebelum ada request apa pun.
   */
  private build(items: PlannedMessage[]): PreparedMessage<ApiMeMessage>[] {
    this.requireConfigured(this.instanceId, 'WHATSAPP_INSTANCE');

    return this.buildItems(
      items,
      (item) => new ApiMeMessage(item.destination, item.message),
      (message) => message.to,
    );
  }

  /**
   * Kirim satu berkas lewat ApiMe.
   *
   * ApiMe menuntut berkasnya diunggah sebagai multipart, bukan dikirim sebagai
   * base64 di dalam JSON, jadi isinya diubah dulu menjadi byte mentah. Ada dua
   * endpoint terpisah dengan nama kolom yang berbeda: gambar memakai
   * `type=image`, dokumen memakai `fileName`.
   *
   * URL publik tidak bisa dipakai di sini — ApiMe tidak mengunduh apa pun
   * sendiri, ia hanya menerima unggahan. Menolaknya di sini memberi pesan yang
   * bisa ditindaklanjuti, bukan kegagalan unggah yang membingungkan.
   */
  protected async sendMedia(
    destination: string,
    file: File,
    caption: string,
  ): Promise<string> {
    this.requireConfigured(this.instanceId, 'WHATSAPP_INSTANCE');

    if (file.isUrl()) {
      throw new ConfigurationException(
        'ApiMe menerima berkasnya sebagai unggahan biner, bukan URL: ' +
          'unduh berkasnya lebih dulu, lalu kirim isinya sebagai base64 atau data URI',
      );
    }

    const to = this.target(destination);

    const endpoint = file.isImage() ? 'messages/media' : 'messages/document';
    const fields: Record<string, string> = file.isImage()
      ? { to, type: 'image' }
      : { to, fileName: file.filename };

    if (caption !== '') {
      fields['caption'] = caption;
    }

    // Kolom teks lebih dulu, berkasnya terakhir — sebagian parser multipart
    // membaca kolom pendamping sesudah bagian berkasnya.
    const parts: MultipartPart[] = Object.entries(fields).map(([name, contents]) => ({
      name,
      contents,
    }));

    parts.push({
      name: 'file',
      contents: file.bytes(),
      filename: file.filename,
      headers: { 'Content-Type': file.mime },
    });

    const body = await this.postMultipartJson(
      `${this.baseUrl}/api/instances/${encodeURIComponent(this.instanceId)}/${endpoint}`,
      parts,
    );

    return `Sukses, messageId: ${this.messageId(body)}`;
  }

  /**
   * Tampilkan atau hapus indikator "sedang mengetik":
   * `POST /api/instances/{id}/whatsapp/presence`.
   *
   * Endpoint ini menuntut token ber-scope instance, sama seperti pengiriman
   * pesan: token user (JWT) ditolak dengan HTTP 403. `duration` tidak ikut
   * dikirim — ApiMe menyimpan statusnya sampai dihapus dengan `paused`.
   */
  protected async sendPresence(
    destination: string,
    presence: Presence,
  ): Promise<string> {
    this.requireConfigured(this.instanceId, 'WHATSAPP_INSTANCE');

    const to = this.target(destination);

    const state = presence.isRecording()
      ? 'recording'
      : presence.isPaused()
        ? 'paused'
        : 'composing';

    await this.postJson(
      `${this.baseUrl}/api/instances/${encodeURIComponent(this.instanceId)}/whatsapp/presence`,
      { to, state },
    );

    return this.presenceResult(presence, to);
  }

  /** `POST /api/instances/{instanceId}/messages/text` */
  private async sendText(message: ApiMeMessage): Promise<string> {
    const body = await this.postJson(
      `${this.baseUrl}/api/instances/${encodeURIComponent(this.instanceId)}/messages/text`,
      message.toArray(),
      // Idempotency-Key deterministik per isi pesan, supaya kartu yang
      // ter-scan dua kali beruntun tidak jadi dua pesan.
      { 'Idempotency-Key': message.idempotencyKey(this.instanceId) },
    );

    return `Sukses, messageId: ${this.messageId(body)}`;
  }

  /**
   * Id pesan dari balasan ApiMe.
   *
   * Sukses dibungkus sebagai `{"data": {...Message}}`, dan sebagian versi
   * menamai idnya `whatsappId`, sebagian `id`.
   */
  private messageId(body: JsonObject): string {
    const data = isArrayLike(body['data']) ? body['data'] : {};

    return toScalarString(data['whatsappId'] ?? data['id'] ?? '-');
  }

  /**
   * ApiMe selalu memakai amplop error `{"error": "..."}`. Beberapa status
   * punya arti khusus yang layak dijelaskan di log, karena angka statusnya
   * sendiri tidak memberi tahu apa yang harus diperbaiki.
   */
  protected describe(status: number, body: JsonObject | null): string {
    const konteks =
      status === 403
        ? 'token harus instance token, bukan JWT user atau API token global'
        : status === 404
          ? 'instance tidak ditemukan, cek WHATSAPP_INSTANCE'
          : status === 409
            ? 'pengiriman dengan Idempotency-Key yang sama masih berjalan'
            : status === 422
              ? 'Idempotency-Key sudah dipakai untuk isi pesan yang berbeda'
              : status === 503
                ? 'sesi WhatsApp belum siap, tidak ada pesan yang terkirim'
                : '';

    const pesan = super.describe(status, body);

    return konteks === '' ? pesan : `${pesan} [${konteks}]`;
  }
}
