import { isScalar, toScalarString } from '../internal/scalar';

/**
 * Pembacaan nilai dari amplop JSON gateway.
 *
 * Tiap gateway menaruh field yang sama dengan bentuk yang berbeda — kadang
 * string, kadang angka, kadang objek bersarang. Pemanggil biasanya hanya butuh
 * teksnya; nilai yang bukan skalar (array, null) dianggap tidak ada.
 */
export class Text {
  static of(value: unknown): string {
    return isScalar(value) ? toScalarString(value) : '';
  }

  /**
   * Nilai pertama yang benar-benar terisi, dalam urutan prioritas.
   *
   * Dipakai karena nama field antar gateway berbeda untuk hal yang sama —
   * mis. nomor telepon ada sebagai `phoneNumber`, `phone_number`, atau `jid`.
   */
  static first(...candidates: unknown[]): string {
    for (const candidate of candidates) {
      const text = Text.of(candidate);
      if (text !== '') return text;
    }
    return '';
  }

  /** Apakah $value sama dengan salah satu $candidates (tanpa peduli besar-kecil). */
  static equalsAny(value: string, ...candidates: string[]): boolean {
    return candidates.some((candidate) => value.toLowerCase() === candidate.toLowerCase());
  }

  /**
   * Panjang teks dalam karakter, bukan byte.
   *
   * Dipakai pacing untuk menilai apakah sebuah pesan tergolong panjang.
   * Panjang byte membuat satu huruf beraksen atau satu emoji terhitung
   * beberapa kali — pesan pendek bisa salah dianggap panjang hanya karena
   * bahasanya.
   */
  static length(value: string): number {
    return [...value].length;
  }
}
