import type { Context } from "hono";
import { Config, ConfigurationException } from "../../lib/sikuwa";
import { responseBadRequest, responseOK } from "../utils/response";
import {
  PROVIDERS,
  whatsappPlaygroundService,
  type PacingPreviewRequest,
  type PlanPreviewRequest,
  type ThrottlePreviewRequest,
  type TypingPreviewRequest,
} from "./service";

/**
 * Endpoint playground untuk pustaka SIKUWA hasil porting.
 *
 * Semua endpoint di sini hanya membaca keputusan yang murni — tidak ada pesan
 * yang benar-benar dikirim. Kegagalan konfigurasi dilaporkan sebagai 400
 * dengan pesan asli dari SDK, supaya halaman playground bisa menampilkan
 * kalimat perbaikan yang sama dengan yang akan dilihat pemakai pustaka.
 */

/**
 * Baca body JSON; body kosong atau tidak sah dianggap objek kosong.
 *
 * Endpoint di sini semuanya punya nilai bawaan yang masuk akal, jadi menolak
 * body kosong hanya akan menyulitkan pemakaian dari halaman playground.
 */
async function readBody<T>(c: Context): Promise<T> {
  try {
    return (await c.req.json()) as T;
  } catch {
    return {} as T;
  }
}

/**
 * Jalankan isi handler, dan ubah kegagalan konfigurasi menjadi 400.
 *
 * Kelas exception yang lebih spesifik — `UnknownProviderException`,
 * `TimeoutException` — semuanya turunan `ConfigurationException`, jadi satu
 * penjagaan di sini sudah mencakup seluruhnya.
 */
async function handle<T>(
  c: Context,
  message: string,
  run: () => T | Promise<T>,
): Promise<Response> {
  try {
    return responseOK(c, message, await run());
  } catch (error) {
    if (error instanceof ConfigurationException) {
      return responseBadRequest(c, error.message);
    }

    throw error;
  }
}

class WhatsappController {
  /** Konfigurasi efektif dari environment, dengan kredensial disamarkan. */
  config = (c: Context) =>
    handle(c, "Konfigurasi SIKUWA berhasil dibaca", () =>
      whatsappPlaygroundService.describeConfig(Config.fromEnvironment()),
    );

  /** Daftar gateway yang dikenali, dan mana yang tokennya benar-benar terisi. */
  providers = (c: Context) =>
    handle(c, "Daftar gateway SIKUWA", () => {
      const config = Config.fromEnvironment();

      return {
        daftar: PROVIDERS,
        // Hanya `WHATSAPP_TOKEN_<Provider>` yang dihitung — token umum tidak
        // menunjukkan gateway mana yang siap dipakai.
        siap: PROVIDERS.filter((name) => config.providerToken(name) !== null),
      };
    });

  pacingPreview = async (c: Context) =>
    handle(c, "Pratinjau pacing", async () =>
      whatsappPlaygroundService.previewPacing(
        await readBody<PacingPreviewRequest>(c),
        Config.fromEnvironment(),
      ),
    );

  typingPreview = async (c: Context) =>
    handle(c, "Pratinjau indikator mengetik", async () =>
      whatsappPlaygroundService.previewTyping(
        await readBody<TypingPreviewRequest>(c),
        Config.fromEnvironment(),
      ),
    );

  throttlePreview = async (c: Context) =>
    handle(c, "Pratinjau pembatas laju", async () =>
      whatsappPlaygroundService.previewThrottle(
        await readBody<ThrottlePreviewRequest>(c),
        Config.fromEnvironment(),
      ),
    );

  presence = async (c: Context) =>
    handle(c, "Keadaan indikator", async () => {
      const body = await readBody<{ state?: string; duration?: unknown }>(c);

      return whatsappPlaygroundService.describePresence(body.state ?? "", body.duration ?? null);
    });

  phone = async (c: Context) =>
    handle(c, "Normalisasi nomor", async () => {
      const body = await readBody<{ number?: string }>(c);

      return whatsappPlaygroundService.normalizePhone(body.number ?? "");
    });

  media = async (c: Context) =>
    handle(c, "Penerjemahan berkas", async () => {
      const body = await readBody<{ payload?: string; filename?: string }>(c);

      return whatsappPlaygroundService.inspectMedia(body.payload ?? "", body.filename ?? "");
    });

  /** Payload Fonnte yang akan dikirim, tanpa mengirim apa pun. */
  planPreview = async (c: Context) =>
    handle(c, "Pratinjau payload", async () =>
      whatsappPlaygroundService.previewPlan(
        await readBody<PlanPreviewRequest>(c),
        Config.fromEnvironment(),
      ),
    );
}

export const whatsappController = new WhatsappController();
