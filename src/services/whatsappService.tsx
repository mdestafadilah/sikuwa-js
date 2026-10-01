import { HTTPError } from "ky";
import { api, http } from "@/lib/http";
import type { ApiResponse } from "@/types/apiResponse";

/**
 * Lapisan layanan untuk playground SIKUWA.
 *
 * Satu hal yang dijaga di sini: pesan kesalahan yang tampil di layar adalah
 * pesan asli dari SDK. Server membalas 400 dengan kalimat perbaikan yang
 * ditulis pustaka (mis. "Kunci 'duration' harus minimal 1 detik"), dan kalimat
 * itu diteruskan apa adanya — supaya yang terlihat di playground persis sama
 * dengan yang akan dilihat pemakai pustaka.
 */

export interface GatewaySummary {
  nama: string;
  tokenTerisi: boolean;
  url: string;
  session: string;
  instance: string;
}

export interface PacingSummary {
  aktif: boolean;
  siklus: number[];
  interval: { min: number; max: number } | null;
  ambangPesanPanjang: number;
  pengaliPesanPanjang: number;
}

export interface TypingSummary {
  aktif: boolean;
  kecepatan: number;
  min: number;
  max: number;
}

export interface ThrottleSummary {
  aktif: boolean;
  max: number;
  window: number;
}

export interface ConfigSummary {
  provider: string;
  notifikasiAktif: boolean;
  timeout: number;
  percobaanUlang: number;
  token: string;
  url: string;
  session: string;
  instance: string;
  tokenAkun: string;
  headerTambahan: string[];
  gateway: GatewaySummary[];
  pacing: PacingSummary;
  typing: TypingSummary;
  throttle: ThrottleSummary;
}

export interface PacingPreview extends PacingSummary {
  jeda: { urutan: number; panjang: number; detik: number | null }[];
}

export interface TypingPreview extends TypingSummary {
  durasi: { panjang: number; detik: number | null }[];
}

export interface ThrottlePreview extends ThrottleSummary {
  jadwal: { urutan: number; detik: number | null }[];
}

export interface PresenceResult {
  keadaan: string;
  durasi: number;
  milidetik: number;
  label: string;
  menampilkanIndikator: boolean;
}

export interface PhoneResult {
  masukan: string;
  normalisasi: string;
  wid: string;
  terpakai: boolean;
}

export interface MediaResult {
  jenis: string;
  namaBerkas: string;
  gambar: boolean;
  url: boolean;
  ukuran: number | null;
  ukuranTerbaca: string;
  batasWhatsApp: number;
  melebihiBatas: boolean;
  dataUri: string;
  panjangBase64: number;
}

/** Satu pesan setelah `plan()` menyelesaikan jeda dan lama indikatornya. */
export interface PlannedMessageSummary {
  destination: string;
  message: string;
  delay: number | null;
  typing: number | null;
}

export interface PlanResult {
  gateway: string;
  jumlahPesan: number;
  tujuanBerulang: string[];
  pesan: PlannedMessageSummary[];
  field: string;
  payload: string;
}

/**
 * Jalankan permintaan dan ambil isinya; ubah kegagalan HTTP menjadi Error yang
 * membawa pesan dari server.
 */
async function unwrap<T>(run: () => Promise<ApiResponse<T>>): Promise<T> {
  try {
    const response = await run();

    if (response.data === null) {
      throw new Error("Server tidak mengirim data.");
    }

    return response.data;
  } catch (error) {
    if (error instanceof HTTPError) {
      const payload = (await error.response
        .json()
        .catch(() => null)) as ApiResponse<unknown> | null;

      throw new Error(payload?.message ?? `Permintaan gagal (${error.response.status}).`);
    }

    throw error;
  }
}

export const whatsappService = {
  getConfig: (): Promise<ConfigSummary> =>
    unwrap(() => http.get(api.whatsapp.config).json<ApiResponse<ConfigSummary>>()),

  getProviders: (): Promise<{ daftar: string[]; siap: string[] }> =>
    unwrap(() =>
      http.get(api.whatsapp.providers).json<ApiResponse<{ daftar: string[]; siap: string[] }>>(),
    ),

  previewPacing: (body: { pacing?: unknown; lengths?: number[] }): Promise<PacingPreview> =>
    unwrap(() =>
      http.post(api.whatsapp.pacingPreview, { json: body }).json<ApiResponse<PacingPreview>>(),
    ),

  previewTyping: (body: { typing?: unknown; lengths?: number[] }): Promise<TypingPreview> =>
    unwrap(() =>
      http.post(api.whatsapp.typingPreview, { json: body }).json<ApiResponse<TypingPreview>>(),
    ),

  previewThrottle: (body: { throttle?: unknown; count?: number }): Promise<ThrottlePreview> =>
    unwrap(() =>
      http
        .post(api.whatsapp.throttlePreview, { json: body })
        .json<ApiResponse<ThrottlePreview>>(),
    ),

  describePresence: (body: { state?: string; duration?: unknown }): Promise<PresenceResult> =>
    unwrap(() =>
      http.post(api.whatsapp.presence, { json: body }).json<ApiResponse<PresenceResult>>(),
    ),

  normalizePhone: (number: string): Promise<PhoneResult> =>
    unwrap(() =>
      http.post(api.whatsapp.phone, { json: { number } }).json<ApiResponse<PhoneResult>>(),
    ),

  inspectMedia: (body: { payload: string; filename?: string }): Promise<MediaResult> =>
    unwrap(() =>
      http.post(api.whatsapp.media, { json: body }).json<ApiResponse<MediaResult>>(),
    ),

  previewPlan: (body: {
    messages?: unknown;
    pacing?: unknown;
    typing?: unknown;
    throttle?: unknown;
  }): Promise<PlanResult> =>
    unwrap(() =>
      http.post(api.whatsapp.planPreview, { json: body }).json<ApiResponse<PlanResult>>(),
    ),
};
