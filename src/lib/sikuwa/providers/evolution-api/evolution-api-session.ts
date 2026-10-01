import { ConfigurationException } from '../../exceptions';
import { isArrayLike, toPhpBool } from '../../internal/scalar';
import { Session } from '../../session';
import type { JsonObject } from '../../support/envelope';
import { Qr } from '../../support/qr';
import { Text } from '../../support/text';
import { EVOLUTION_API_NAME } from './constants';

/**
 * Instance Evolution API — menyusun payload `POST /instance/create` dan
 * menormalkan balasan menjadi {@link Session}.
 *
 * Baik `POST /instance/create` maupun `GET /instance/connectionState/{instance}`
 * membungkus datanya di dalam kunci `instance`, jadi satu penormal cukup untuk
 * keduanya. Bedanya hanya nama field status: create memakai `status`, sedangkan
 * connectionState memakai `state` — dengan nilai yang sama (`open`, `connecting`,
 * `close`, `refused`). Itu pula sebabnya `showQr()` di provider tidak punya
 * penormal tersendiri: `GET /instance/connect/{instance}` juga dibaca di sini.
 */
export class EvolutionAPISession {
  /** State Evolution API yang berarti sesi siap mengirim pesan. */
  static readonly CONNECTED = 'open';

  /**
   * Payload untuk `POST /instance/create`.
   *
   * @param options     Kunci yang dikenali: `instanceName` (alias `name`),
   *                    `token`, `integration`, `webhook`, `events`, `qrcode`.
   * @param defaultName Dipakai kalau nama tidak diberikan — biasanya dari
   *                    `WHATSAPP_INSTANCE`.
   */
  static payload(
    options: Record<string, unknown>,
    defaultName = '',
  ): Record<string, unknown> {
    const name = Text.first(
      options['instanceName'] ?? null,
      options['name'] ?? null,
      defaultName,
    );

    if (name === '') {
      throw new ConfigurationException(
        "Evolution API membutuhkan nama instance: isi WHATSAPP_INSTANCE atau kirim ['instanceName' => ...]",
      );
    }

    // Evolution menolak nama bersimbol ("use only non-accented lowercase
    // alphabetic characters or numbers"). Menangkapnya di sini membuat
    // kesalahannya jelas, bukan HTTP 400 yang harus ditebak. `$` di JavaScript
    // dan PHP sama-sama cocok sebelum baris baru di ujung, jadi keduanya
    // memperlakukan nama berakhiran "\n" dengan cara yang sama.
    if (!/^[a-z0-9]+$/.test(name)) {
      throw new ConfigurationException(
        `Nama instance Evolution API hanya boleh huruf kecil dan angka, diberikan: ${name}`,
      );
    }

    const payload: Record<string, unknown> = {
      instanceName: name,
      // `(bool)` PHP, bukan `filter_var`: string apa pun yang bukan '' dan '0'
      // bernilai benar, sehingga `qrcode: 'ya'` tetap menyalakannya.
      qrcode: toPhpBool(options['qrcode'] ?? true),
    };

    for (const key of ['token', 'integration', 'webhook']) {
      const value = Text.of(options[key] ?? null);

      if (value !== '') {
        payload[key] = value;
      }
    }

    const events = options['events'] ?? null;

    // Diteruskan apa adanya: isinya milik Evolution dan bisa bertambah antar
    // versi, jadi memaku satu bentuk akan membuat SDK rusak diam-diam.
    if (isArrayLike(events) && Object.keys(events).length > 0) {
      payload['events'] = events;
    }

    return payload;
  }

  /**
   * Terima balasan `POST /instance/create`, `GET /instance/connectionState/{instance}`,
   * maupun `GET /instance/connect/{instance}`.
   */
  static fromResponse(body: JsonObject, fallbackId = ''): Session {
    const instance = isArrayLike(body['instance']) ? body['instance'] : {};
    const qrcode = isArrayLike(body['qrcode']) ? body['qrcode'] : {};

    const status = Text.first(instance['state'] ?? null, instance['status'] ?? null);

    // `POST /instance/create` menerbitkan API key instance di `hash` —
    // sebagian versi mengirim objek `{apikey: ...}`, sebagian string.
    const hash = body['hash'] ?? null;

    return new Session({
      provider: EVOLUTION_API_NAME,
      id: Text.first(instance['instanceName'] ?? null, fallbackId),
      status,
      connected: Text.equalsAny(status, EvolutionAPISession.CONNECTED),
      // Saat instance masih `close`, QR-nya ada di dalam blok `qrcode`;
      // `GET /instance/connect` mengembalikannya di akar body.
      qr: Qr.dataUri(Text.first(qrcode['base64'] ?? null, body['base64'] ?? null)),
      token: isArrayLike(hash) ? Text.of(hash['apikey'] ?? null) : Text.of(hash),
      phoneNumber: Text.of(instance['owner'] ?? null),
      profileName: Text.first(instance['profileName'] ?? null, instance['profile_name'] ?? null),
      raw: body,
    });
  }
}
