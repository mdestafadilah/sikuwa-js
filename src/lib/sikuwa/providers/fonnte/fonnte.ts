import type { Config, ConfigOptions } from '../../config';
import type { MessageInput } from '../../contracts/whatsapp';
import {
  ApiException,
  ConfigurationException,
  NotFoundException,
} from '../../exceptions';
import type { HttpExecutor, MultipartPart } from '../../http/http-executor';
import type { HttpResponse } from '../../http/http-response';
import { isEmpty, toScalarString } from '../../internal/scalar';
import { Session } from '../../session';
import type { JsonObject } from '../../support/envelope';
import { File } from '../../support/file';
import { PhoneNumber } from '../../support/phone-number';
import { Presence } from '../../support/presence';
import { AbstractProvider } from '../abstract-provider';
import { FONNTE_DEFAULT_URL, FONNTE_NAME } from './constants';
import { FonnteBulkMessage } from './fonnte-bulk-message';
import { FonnteSession } from './fonnte-session';
import { FonnteShowQr } from './fonnte-show-qr';

/**
 * Gateway Fonnte (https://fonnte.com), layanan WhatsApp berbayar berbasis cloud.
 *
 * Konfigurasi:
 *   WHATSAPP_PROVIDER     = Fonnte
 *   WHATSAPP_TOKEN        = token perangkat Fonnte, dikirim sebagai header `Authorization`
 *   WHATSAPP_ACCOUNT_TOKEN = token akun, khusus Device API (add/get/update/delete
 *                            device). Token perangkat DITOLAK di sana.
 *   WHATSAPP_URL_Fonnte   = opsional; hanya kalau perlu lewat proxy/endpoint lain
 *
 * Berbeda dari gateway self-hosted lain di SDK ini, Fonnte adalah layanan
 * pihak ketiga dengan satu endpoint tetap. Karena itu `WHATSAPP_URL` — kunci
 * bersama yang biasanya ditujukan untuk gateway self-hosted — **tidak** dibaca
 * di sini: kalau dibaca, satu nilai `WHATSAPP_URL` akan mengalihkan pengiriman
 * Fonnte ke host yang salah.
 *
 * Yang diterima hanya URL yang jelas milik Fonnte: opsi `url` yang eksplisit,
 * atau `WHATSAPP_URL_Fonnte`. Keduanya tidak mungkin tertukar dengan gateway
 * lain, jadi aman — dan berguna kalau pengiriman perlu lewat proxy.
 */
export class Fonnte extends AbstractProvider {
  static readonly NAME = FONNTE_NAME;

  static readonly DEFAULT_URL = FONNTE_DEFAULT_URL;

  private readonly urlApi: string;

  /** Host Device API — sama dengan host pengiriman, tanpa sufiks `/send`. */
  private readonly deviceBase: string;

  constructor(options?: ConfigOptions | Config | null, http?: HttpExecutor | null) {
    super(options, http);

    this.urlApi =
      this.config.explicitUrl() ?? this.config.providerUrl(Fonnte.NAME) ?? Fonnte.DEFAULT_URL;

    // Diturunkan dari urlApi, bukan ditulis ulang, supaya override lewat
    // `WHATSAPP_URL_Fonnte` (mis. proxy) ikut berlaku untuk Device API.
    this.deviceBase = this.urlApi.replace(/\/send$/, '');
  }

  getProvider(): string {
    return Fonnte.NAME;
  }

  protected authHeaders(): Record<string, string> {
    return { Authorization: this.getToken() };
  }

  /**
   * Tambah perangkat baru: `POST /add-device`.
   *
   * Menuntut **account token** (`WHATSAPP_ACCOUNT_TOKEN`), bukan token
   * perangkat yang dipakai mengirim pesan — keduanya kredensial yang
   * berbeda, dan Device API menolak token perangkat dengan `"unknown user"`.
   *
   * Perangkat yang berhasil dibuat menerbitkan tokennya di `Session.token`.
   * Simpan nilainya ke `WHATSAPP_TOKEN` supaya pesan bisa dikirim lewat
   * perangkat itu.
   *
   * Kunci `options` yang dikenali: `name` (wajib), `device` (wajib), lalu
   * opsional `autoread`, `personal`, `group`.
   */
  async createSession(options: Record<string, unknown> = {}): Promise<Session> {
    const body = await this.postJson(
      `${this.deviceBase}/add-device`,
      FonnteSession.payload(options),
      this.accountHeaders(),
    );

    return FonnteSession.fromCreated(this.requireStatus(body));
  }

  /**
   * Baca keadaan perangkat: `POST /get-devices`.
   *
   * Perangkat dicari dengan `id` bila diberikan (nomor atau nama); kalau
   * tidak, dengan token perangkat yang sedang dipakai SDK ini. Jadi
   * `checkSession()` tanpa argumen menjawab pertanyaan yang sebenarnya ingin
   * diketahui pemanggil: "apakah perangkat yang saya pakai sudah siap?".
   *
   * @param id Nomor atau nama perangkat; default token aktif.
   */
  async checkSession(id?: string | null): Promise<Session> {
    const needle = id !== null && id !== undefined && id !== '' ? id : this.getToken();

    if (needle === '') {
      throw new ConfigurationException(
        'Tentukan perangkat yang diperiksa: kirim nomor/nama perangkat, atau isi WHATSAPP_TOKEN',
      );
    }

    const body = this.requireStatus(
      await this.postJson(`${this.deviceBase}/get-devices`, null, this.accountHeaders()),
    );

    const device = FonnteSession.findDevice(body, needle);

    if (device === null) {
      throw new NotFoundException(
        `Perangkat '${needle}' tidak ditemukan di akun Fonnte`,
        404,
        body,
      );
    }

    return FonnteSession.fromDevice(device, body);
  }

  /**
   * Ambil QR perangkat: `POST /qr`.
   *
   * Memakai **token perangkat** (`WHATSAPP_TOKEN`) — berbeda dari
   * `createSession()`/`checkSession()` yang memakai account token — karena
   * yang ditanyakan di sini adalah perangkat yang tokennya sedang dipakai.
   *
   * Fonnte mengirim base64 PNG telanjang di `url`, tanpa awalan `data:`.
   * Perangkat yang sudah tersambung tidak menerima QR melainkan
   * `{"status":false,"reason":"device already connect"}`, dan itu dilaporkan
   * sebagai sesi `connected` tanpa QR, bukan sebagai kegagalan.
   *
   * @param id Nomor perangkat; dinormalkan lalu dikirim sebagai `whatsapp`.
   *           Boleh dikosongkan — token yang dipakai sudah menentukan
   *           perangkatnya.
   */
  async showQr(id?: string | null): Promise<Session> {
    // `type` selalu "qr": yang diminta pemanggil adalah gambar QR-nya.
    // Mode "code" (kode pairing) punya alur sendiri dan belum didukung.
    const payload: Record<string, unknown> = { type: 'qr' };

    const device = PhoneNumber.normalize(String(id ?? ''));

    if (device !== '') {
      payload['whatsapp'] = device;
    }

    const body = await this.postJson(`${this.deviceBase}/qr`, payload, this.authHeaders());

    if (FonnteShowQr.isAlreadyConnected(body)) {
      return FonnteShowQr.alreadyConnected(body);
    }

    return FonnteShowQr.fromResponse(this.requireStatus(body));
  }

  /**
   * Header Device API Fonnte, yang memakai account token.
   */
  private accountHeaders(): Record<string, string> {
    const token = this.config.accountToken();

    if (token === '') {
      throw new ConfigurationException(
        'Fonnte Device API membutuhkan account token: isi WHATSAPP_ACCOUNT_TOKEN ' +
          '(token perangkat ditolak di sini dengan "unknown user")',
      );
    }

    return { Authorization: token };
  }

  /**
   * Fonnte membalas HTTP 200 bahkan saat menolak, jadi keberhasilan
   * sebenarnya dibaca dari field `status` — status HTTP tidak pernah cukup.
   * Kegagalannya tetap dilaporkan sebagai HTTP 200, sesuai amplop yang
   * benar-benar diterima.
   */
  private requireStatus(body: JsonObject): JsonObject {
    if (body['status'] === true) {
      return body;
    }

    const reason = this.detail(body);

    throw new ApiException(
      reason !== '' ? reason : 'Fonnte menolak permintaan',
      200,
      body,
      reason !== '' ? reason : null,
    );
  }

  /**
   * Kirim pesan ke Fonnte.
   *
   * Fonnte selalu membalas HTTP 200; keberhasilan sebenarnya ada di field
   * `status`. Karena itu respons 2xx dengan `status` kosong tetap dilaporkan
   * sebagai kegagalan.
   *
   * Jeda antar pesan diserahkan ke server lewat kolom `delay` tiap pesan;
   * bila pemanggil tidak mengisinya, nilainya diambil dari pacing
   * (`WHATSAPP_PACING_*`), lalu jatuh ke bawaan 2 detik.
   *
   * @return `"Sukses: <detail>"` atau `"Sukses"` — awalan `Sukses` adalah
   *         penanda seragam antar provider, dipakai pemanggil untuk memilih
   *         level log.
   */
  async sendMessage(message: MessageInput): Promise<string> {
    const items = this.plan(message);

    if (items.length === 0) {
      return 'Tidak ada pesan untuk dikirim';
    }

    const payload = this.compose(() => new FonnteBulkMessage(items).toJson());

    // Fonnte menerima seluruh batch dalam satu field `data`, jadi SDK tidak
    // punya kesempatan menyisipkan indikator di antara pesan. Yang bisa
    // dilakukan adalah memunculkannya untuk tujuan pesan pertama:
    // memunculkan untuk semua tujuan sekaligus justru membuat penerima
    // terakhir melihat "sedang mengetik" lalu diam lama sebelum pesannya
    // datang, dan itu lebih buruk daripada tanpa indikator.
    await this.announceTyping(items[0] ?? null);

    return this.sent(
      await this.http.post(this.urlApi, { data: payload }, this.authHeaders()),
    );
  }

  /**
   * Kirim satu berkas ke Fonnte.
   *
   * Fonnte tidak punya kolom base64: berkasnya harus diunggah sebagai
   * multipart, atau diserahkan sebagai URL publik supaya server Fonnte yang
   * mengunduhnya. Karena itu data URI dan base64 telanjang diubah dulu
   * menjadi byte mentah.
   *
   * Pengiriman media baru tersedia pada paket berbayar (super/advanced/
   * ultra). Fonnte menolaknya lewat `reason` seperti kegagalan lain, jadi
   * pesannya muncul apa adanya di log.
   */
  protected async sendMedia(
    destination: string,
    file: File,
    caption: string,
  ): Promise<string> {
    const target = PhoneNumber.normalize(destination);

    if (target === '') {
      throw new ConfigurationException(`Nomor tujuan '${destination}' tidak valid`);
    }

    const parts: MultipartPart[] = [
      { name: 'target', contents: target },
      // `filename` hanya dipakai Fonnte untuk berkas dan audio, tapi
      // mengirimkannya selalu aman.
      { name: 'filename', contents: file.filename },
    ];

    if (caption !== '') {
      parts.push({ name: 'message', contents: caption });
    }

    if (file.isUrl()) {
      parts.push({ name: 'url', contents: file.payload });
    } else {
      parts.push({
        name: 'file',
        contents: file.bytes(),
        filename: file.filename,
        headers: { 'Content-Type': file.mime },
      });
    }

    return this.sent(await this.http.postMultipart(this.urlApi, parts, this.authHeaders()));
  }

  /**
   * Tampilkan atau hentikan indikator "sedang mengetik": `POST /typing`.
   *
   * Fonnte memakai satu endpoint dengan kolom `stop`, bukan dua keadaan yang
   * saling menggantikan seperti gateway lain. `duration` juga dituntut di
   * sini — itulah lama indikatornya tampil, dan Fonnte sendiri yang
   * menghitungnya, bukan SDK.
   *
   * Fonnte tidak punya indikator merekam suara, jadi permintaan `recording`
   * ditolak dengan jelas alih-alih diam-diam berubah menjadi indikator
   * mengetik.
   */
  protected async sendPresence(
    destination: string,
    presence: Presence,
  ): Promise<string> {
    const target = PhoneNumber.normalize(destination);

    if (target === '') {
      throw new ConfigurationException(`Nomor tujuan '${destination}' tidak valid`);
    }

    if (presence.isRecording()) {
      throw new ConfigurationException(
        'Fonnte tidak punya indikator merekam suara, hanya indikator mengetik: ' +
          "pakai 'composing', atau gateway lain untuk 'recording'",
      );
    }

    // `duration` selalu ikut karena Fonnte menandainya wajib; saat
    // berhenti, angkanya tidak lagi menentukan apa pun.
    const form: Record<string, unknown> = { target, duration: presence.duration };

    if (presence.isPaused()) {
      // Boolean Fonnte dibaca dari teks, sama seperti di Device API.
      form['stop'] = 'true';
    }

    await this.accepted(
      await this.http.post(`${this.deviceBase}/typing`, form, this.authHeaders()),
      'indikator ketik',
    );

    return this.presenceResult(presence, target);
  }

  /**
   * Baca balasan Fonnte dan pastikan `status` benar-benar berhasil.
   *
   * Fonnte selalu membalas HTTP 200, bahkan saat menolak; keberhasilan
   * sebenarnya ada di field `status`. Dipakai bersama oleh pengiriman teks,
   * pengiriman berkas, dan indikator ketik supaya ketiganya ditolak dengan
   * kalimat yang sama.
   *
   * @param subject Apa yang ditolak, untuk pesan error — mis. `pesan`.
   */
  private accepted(response: HttpResponse, subject = 'pesan'): JsonObject {
    let body = this.read(response);

    if (!response.isSuccess()) {
      return this.reject(response, body);
    }

    body = this.requireJson(body, response.status);

    if (isEmpty(body['status'])) {
      const reason = this.detail(body);

      throw new ApiException(
        reason !== '' ? reason : `Fonnte menolak ${subject} (HTTP ${response.status})`,
        response.status,
        body,
        reason !== '' ? reason : null,
      );
    }

    return body;
  }

  /**
   * Terjemahkan balasan Fonnte menjadi string hasil pengiriman.
   */
  private sent(response: HttpResponse): string {
    const body = this.accepted(response);

    // `detail` boleh berupa daftar (mis. satu baris per tujuan) maupun teks
    // tunggal; keduanya disatukan supaya pemanggil selalu menerima satu
    // kalimat.
    const raw = body['detail'] ?? '';
    const detail = Array.isArray(raw)
      ? raw.map((part) => toScalarString(part)).join('; ')
      : toScalarString(raw);

    return detail !== '' ? `Sukses: ${detail}` : 'Sukses';
  }
}
