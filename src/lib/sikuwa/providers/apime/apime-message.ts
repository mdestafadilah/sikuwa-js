import { sha256Hex } from '../../internal/sha256';
import { PhoneNumber } from '../../support/phone-number';

/**
 * Satu pesan teks ApiMe setelah nomor tujuannya disiapkan.
 *
 * Ditulis sebagai `type`, bukan `interface`: hanya type alias yang mendapat
 * *implicit index signature*, sehingga hasilnya bisa diteruskan ke `postJson()`
 * yang menuntut `Record<string, unknown>`.
 */
export type ApiMeTextPayload = {
  to: string;
  text: string;
};

/**
 * Satu pesan teks untuk ApiMe.
 *
 * ApiMe menerima nomor dalam format internasional tanpa tanda plus
 * (mis. `"6281234567890"`) dan menambahkan sendiri sufiks `"@s.whatsapp.net"`.
 * JID grup (`"...@g.us"`) harus ditulis lengkap dan diteruskan apa adanya —
 * menormalkannya akan merusak identitas grup, sama seperti di
 * `AbstractProvider.target()`.
 */
export class ApiMeMessage {
  to: string;

  readonly message: string;

  constructor(destination: string, message: string) {
    this.to = destination.includes('@')
      ? destination
      : PhoneNumber.normalize(destination);
    this.message = message;
  }

  /** Payload untuk `POST /api/instances/{id}/messages/text`. */
  toArray(): ApiMeTextPayload {
    return {
      to: this.to,
      text: this.message,
    };
  }

  /**
   * `Idempotency-Key` deterministik: dua permintaan dengan instance, tujuan,
   * dan isi yang persis sama dalam 24 jam hanya menghasilkan satu pesan
   * WhatsApp. Berguna kalau kartu ter-scan dua kali beruntun.
   *
   * Deterministik itu syaratnya, bukan bonus: kunci acak akan membuat setiap
   * percobaan ulang menjadi pesan baru, dan justru menggagalkan tujuannya.
   * Karena itu isinya diturunkan dari ketiga nilai itu saja, tanpa waktu.
   *
   * Hash-nya dihitung `internal/sha256.ts` yang sinkron dan tanpa dependensi —
   * `crypto.subtle` asinkron, sedangkan tanda tangan method ini harus tetap
   * sinkron seperti `hash('sha256', …)` di PHP.
   */
  idempotencyKey(instanceId: string): string {
    return `siku-${sha256Hex(`${instanceId}|${this.to}|${this.message}`)}`;
  }
}
