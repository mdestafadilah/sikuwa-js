import { PhoneNumber } from '../../support/phone-number';

/**
 * Payload untuk `POST /message/sendText/{instance}`.
 *
 * Ditulis sebagai `type`, bukan `interface`: hanya type alias yang mendapat
 * *implicit index signature*, sehingga hasilnya bisa diteruskan ke `postJson()`
 * yang menuntut `Record<string, unknown>`. `interface` dengan bentuk yang sama
 * persis akan ditolak TypeScript.
 */
export type EvolutionAPITextPayload = {
  number: string;
  text: string;
  delay?: number;
};

/**
 * Satu pesan teks untuk Evolution API.
 *
 * Kolom `number` berupa string bebas: nomor internasional tanpa tanda plus
 * (mis. `"6281234567890"`) atau JID lengkap untuk grup (`"...@g.us"`), yang
 * diteruskan apa adanya. Perlakuan itu sama dengan `AbstractProvider.target()`,
 * tetapi disalin ke sini karena DTO ini juga dipakai di luar jalur kirim.
 */
export class EvolutionAPIMessage {
  number: string;

  readonly message: string;

  /** Jeda sebelum kirim, dalam DETIK — dikonversi ke milidetik di {@link toArray}. */
  readonly delay: number;

  constructor(destination: string, message: string, delay = 0) {
    this.number = destination.includes('@')
      ? destination
      : PhoneNumber.normalize(destination);
    this.message = message;
    this.delay = delay;
  }

  /** Payload untuk `POST /message/sendText/{instance}`. */
  toArray(): EvolutionAPITextPayload {
    const payload: EvolutionAPITextPayload = {
      number: this.number,
      text: this.message,
    };

    // Evolution menghitung delay dalam milidetik, sementara antarmuka SDK ini
    // memakai detik seperti Fonnte. Konversinya dilakukan di sini — satu-satunya
    // tempat yang tahu satuan asal nilainya — bukan di provider, supaya
    // pemanggil yang membaca payload mentah tidak salah menafsirkan angkanya.
    if (this.delay > 0) {
      payload.delay = this.delay * 1000;
    }

    return payload;
  }
}
