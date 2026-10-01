import type { Config, ConfigOptions } from '../../config';
import type { MessageInput } from '../../contracts/whatsapp';
import type { HttpExecutor } from '../../http/http-executor';
import { isArrayLike, toInt, toScalarString } from '../../internal/scalar';
import { Session } from '../../session';
import type { JsonObject } from '../../support/envelope';
import type { File } from '../../support/file';
import type { Presence } from '../../support/presence';
import {
  AbstractProvider,
  type PlannedMessage,
  type PreparedMessage,
} from '../abstract-provider';
import { EVOLUTION_API_DEFAULT_URL, EVOLUTION_API_NAME } from './constants';
import { EvolutionAPIMessage } from './evolution-api-message';
import { EvolutionAPISession } from './evolution-api-session';

/**
 * Gateway Evolution API (https://github.com/evolution-foundation/evolution-api),
 * WhatsApp self-hosted berbasis Node.js + Baileys.
 *
 * Konfigurasi:
 *   WHATSAPP_PROVIDER = EvolutionAPI
 *   WHATSAPP_TOKEN    = API key global (AUTHENTICATION_API_KEY) atau token
 *                       instance; keduanya diterima lewat header `apikey`
 *   WHATSAPP_URL_EvolutionAPI = base URL instance, mis. https://v7.rspwa.example.com
 *                               (`WHATSAPP_URL` juga dibaca sebagai fallback umum)
 *   WHATSAPP_INSTANCE = nama instance yang sudah tersambung
 *                       (`WHATSAPP_INSTANCE_EvolutionAPI` menang atasnya,
 *                       sehingga tiap gateway bisa punya instance sendiri)
 *
 * ## Satuan delay: milidetik, bukan detik
 *
 * Antarmuka SDK ini memakai **detik** di seluruh provider, dan Evolution API
 * memakai **milidetik**. Konversinya dikerjakan `EvolutionAPIMessage.toArray()`
 * untuk jalur teks dan `Presence.milliseconds()` untuk presence — jadi pemanggil
 * tetap menulis angka detik yang sama seperti di gateway lain.
 */
export class EvolutionAPI extends AbstractProvider {
  static readonly NAME = EVOLUTION_API_NAME;

  static readonly DEFAULT_URL = EVOLUTION_API_DEFAULT_URL;

  private readonly baseUrl: string;

  private readonly instanceName: string;

  constructor(options?: ConfigOptions | Config | null, http?: HttpExecutor | null) {
    super(options, http);

    this.baseUrl = this.config.url(EvolutionAPI.DEFAULT_URL, EvolutionAPI.NAME);
    // Nama provider ikut diberikan supaya `WHATSAPP_INSTANCE_EvolutionAPI`
    // didahulukan — lihat `Config.instance()`.
    this.instanceName = this.config.instance(EvolutionAPI.NAME);
  }

  getProvider(): string {
    return EvolutionAPI.NAME;
  }

  getInstanceName(): string {
    return this.instanceName;
  }

  protected authHeaders(): Record<string, string> {
    // Evolution membaca kredensialnya dari header `apikey` — bukan
    // `Authorization` — dan menerima API key global maupun token instance.
    return { apikey: this.getToken() };
  }

  /**
   * Buat instance baru: `POST /instance/create`.
   *
   * Dengan `qrcode => true` (bawaan), balasannya sudah membawa QR di
   * `qrcode.base64` sehingga sesi bisa langsung dipindai. Nama instance hanya
   * boleh huruf kecil dan angka.
   *
   * Kunci `options` yang dikenali: `instanceName` (alias `name`), `token`,
   * `integration`, `webhook`, `events`, `qrcode`.
   */
  async createSession(options: Record<string, unknown> = {}): Promise<Session> {
    const payload = EvolutionAPISession.payload(options, this.instanceName);
    const body = await this.postJson(`${this.baseUrl}/instance/create`, payload);

    return EvolutionAPISession.fromResponse(body, toScalarString(payload['instanceName'] ?? ''));
  }

  /**
   * Baca keadaan instance: `GET /instance/connectionState/{instance}`.
   *
   * @param id Instance yang diperiksa; default dari `WHATSAPP_INSTANCE`.
   */
  async checkSession(id?: string | null): Promise<Session> {
    const instanceName = this.requireConfigured(id ?? this.instanceName, 'WHATSAPP_INSTANCE');

    return EvolutionAPISession.fromResponse(
      await this.getJson(
        `${this.baseUrl}/instance/connectionState/${encodeURIComponent(instanceName)}`,
      ),
      instanceName,
    );
  }

  /**
   * Ambil QR instance: `GET /instance/connect/{instance}`.
   *
   * Balasannya berubah mengikuti keadaan instance. Selama masih `close`,
   * QR-nya ada di `base64`; begitu instance `open`, Evolution membalas
   * keadaan instancenya alih-alih QR. Kedua bentuk itu sudah dikenali
   * `EvolutionAPISession.fromResponse()`, jadi di sini tidak perlu penormal
   * tersendiri — hasilnya sesi `connected` tanpa QR.
   */
  async showQr(id?: string | null): Promise<Session> {
    const instanceName = this.requireConfigured(id ?? this.instanceName, 'WHATSAPP_INSTANCE');

    return EvolutionAPISession.fromResponse(
      await this.getJson(`${this.baseUrl}/instance/connect/${encodeURIComponent(instanceName)}`),
      instanceName,
    );
  }

  /**
   * Kirim pesan lewat Evolution API.
   *
   * Evolution tidak punya endpoint batch, jadi beberapa pesan dikirim satu per
   * satu. Jeda antar pesan diserahkan ke server lewat kolom `delay`
   * (Evolution menunggu sebelum mengirim), sehingga pemanggil tetap menunggu
   * selama jeda itu — tetapi **bukan** karena SDK menidurkannya sendiri.
   */
  async sendMessage(message: MessageInput): Promise<string> {
    return this.sendIndividually(
      message,
      (items) => this.build(items),
      (msg) => this.sendText(msg),
      (msg) => msg.number,
    );
  }

  /**
   * Susun item `plan()` menjadi pesan Evolution API.
   *
   * Instance diperiksa di sini, bukan di `sendMessage()`, supaya jalurnya sama
   * dengan provider lain: `sendIndividually()` memanggil `build()` tepat sekali
   * sebelum ada request apa pun.
   */
  private build(items: PlannedMessage[]): PreparedMessage<EvolutionAPIMessage>[] {
    this.requireConfigured(this.instanceName, 'WHATSAPP_INSTANCE');

    return this.buildItems(
      items,
      (item) => new EvolutionAPIMessage(item.destination, item.message, toInt(item.delay ?? 0)),
      (message) => message.number,
      // Jeda dititipkan ke server lewat payload, jadi klien tidak perlu ikut
      // menunggu di antara request — kalau ikut menunggu, pemanggil menunggu
      // dua kali.
      true,
    );
  }

  /**
   * Kirim satu berkas lewat Evolution API.
   *
   * Satu endpoint untuk semua jenis (`sendMedia`); yang membedakan hanya kolom
   * `mediatype`. Evolution menerima `media` berupa URL publik atau base64, tapi
   * **bukan** data URI: pemeriksaannya memakai `isBase64()` milik
   * class-validator, yang tidak mengenali awalan `data:…;base64,`. Jadi isinya
   * harus base64 telanjang — itulah gunanya `File.base64()` alih-alih
   * `File.dataUri()`. Untuk dokumen berbasis base64, `fileName` wajib diisi —
   * tanpa itu Evolution menolak dengan HTTP 400.
   */
  protected async sendMedia(
    destination: string,
    file: File,
    caption: string,
  ): Promise<string> {
    this.requireConfigured(this.instanceName, 'WHATSAPP_INSTANCE');

    const number = this.target(destination);

    const payload: Record<string, unknown> = {
      number,
      mediatype: file.isImage() ? 'image' : 'document',
      mimetype: file.mime,
    };

    if (caption !== '') {
      payload['caption'] = caption;
    }

    // URL publik dikirim apa adanya supaya server Evolution yang mengunduhnya;
    // selain itu isinya harus base64 telanjang, bukan data URI.
    if (file.isUrl()) {
      payload['media'] = file.payload;
    } else {
      payload['media'] = file.base64();
    }

    // Nama berkas hanya bermakna untuk dokumen; bagi gambar Evolution memakai
    // `mimetype` saja. Tanpa `fileName`, dokumen berbasis base64 ditolak 400.
    if (!file.isImage()) {
      payload['fileName'] = file.filename;
    }

    const body = await this.postJson(
      `${this.baseUrl}/message/sendMedia/${encodeURIComponent(this.instanceName)}`,
      payload,
    );

    // Sukses mengembalikan objek pesan Baileys; id-nya ada di key.id.
    const key = isArrayLike(body['key']) ? body['key'] : {};

    return `Sukses, messageId: ${toScalarString(key['id'] ?? '-')}`;
  }

  /**
   * Evolution API menahan dan membersihkan indikatornya sendiri.
   *
   * Satu panggilan `sendPresence()` sudah berisi composing, jeda, dan paused
   * sekaligus, jadi `AbstractProvider.announceTyping()` tidak boleh menunggu
   * lagi — pemanggil akan menunggu dua kali lebih lama daripada yang diminta.
   * Itu sebabnya nilai ini `true`, berbeda dari enam gateway lainnya.
   */
  protected presenceBlocks(): boolean {
    return true;
  }

  /**
   * Tampilkan atau hapus indikator "sedang mengetik":
   * `POST /chat/sendPresence/{instance}`.
   *
   * Berbeda dari gateway lain, Evolution **menahan sendiri** indikatornya:
   * servernya mengirim `composing`, menunggu `delay`, lalu mengirim `paused`.
   * Dua akibatnya perlu diketahui pemanggil:
   *
   * - `delay` wajib diisi. Tanpa angka, Evolution mengirim `composing` lalu
   *   langsung `paused` tanpa jeda, sehingga indikatornya tidak sempat
   *   terlihat — karena itu `Presence` menuntut `duration`, bukan opsional;
   * - panggilan ini ikut MENUNGGU selama `duration`, karena yang menidurkan
   *   permintaan adalah servernya. Durasi di atas 20 detik dipotong Evolution
   *   menjadi beberapa siklus.
   */
  protected async sendPresence(
    destination: string,
    presence: Presence,
  ): Promise<string> {
    this.requireConfigured(this.instanceName, 'WHATSAPP_INSTANCE');

    const number = this.target(destination);

    await this.postJson(
      `${this.baseUrl}/chat/sendPresence/${encodeURIComponent(this.instanceName)}`,
      {
        number,
        presence: presence.state,
        // Skema Evolution menandai `delay` wajib, dan satuannya milidetik —
        // bukan detik seperti di kunci pemanggil.
        delay: presence.milliseconds(),
      },
    );

    return this.presenceResult(presence, number);
  }

  /** `POST /message/sendText/{instanceName}` */
  private async sendText(message: EvolutionAPIMessage): Promise<string> {
    const body = await this.postJson(
      `${this.baseUrl}/message/sendText/${encodeURIComponent(this.instanceName)}`,
      message.toArray(),
    );

    // Sukses mengembalikan objek pesan Baileys; id-nya ada di key.id.
    const key = isArrayLike(body['key']) ? body['key'] : {};

    return `Sukses, messageId: ${toScalarString(key['id'] ?? '-')}`;
  }

  /**
   * Evolution memakai amplop error
   * `{"status":N,"error":"...","response":{"message": ... }}`,
   * dengan `message` bisa berupa string maupun array pesan validasi.
   * Pengambilan detailnya ditangani {@link AbstractProvider.detail}.
   */
  protected describe(status: number, body: JsonObject | null): string {
    const konteks =
      status === 401
        ? 'apikey salah, cek WHATSAPP_TOKEN'
        : status === 403
          ? 'instance belum tersambung ke WhatsApp'
          : status === 404
            ? 'instance tidak ditemukan, cek WHATSAPP_INSTANCE'
            : '';

    const pesan = super.describe(status, body);

    return konteks === '' ? pesan : `${pesan} [${konteks}]`;
  }
}
