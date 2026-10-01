/** Satu baris pesan seperti yang dibaca Fonnte di dalam field `data`. */
export interface FonnteLine {
  target: string;
  message: string;
  /** Fonnte menerima `delay` sebagai **string**, bukan angka, satuannya detik. */
  delay: string;
}

/**
 * Satu pesan teks untuk Fonnte.
 *
 * Bentuknya sengaja dibuat sebagai objek kecil, bukan langsung sebuah peta:
 * `delay` harus diubah menjadi string, dan aturan itu lebih baik tinggal di
 * satu tempat daripada diulang di setiap jalur yang menyusun payload.
 */
export class FonnteMessage {
  /** Jeda bawaan antar pesan, dalam detik, bila pemanggil tidak mengisinya. */
  static readonly DEFAULT_DELAY = 2;

  constructor(
    readonly target: string,
    readonly message: string,
    readonly delay: number = FonnteMessage.DEFAULT_DELAY,
  ) {}

  toArray(): FonnteLine {
    return {
      target: this.target,
      message: this.message,
      delay: String(this.delay),
    };
  }
}
