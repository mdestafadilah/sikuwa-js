import { Hono } from "hono";
import { whatsappController } from "./controller";

const whatsappRoute = new Hono();

// Membaca — tidak mengubah apa pun, tidak mengirim pesan.
whatsappRoute.get("/config", whatsappController.config);
whatsappRoute.get("/providers", whatsappController.providers);

// Menghitung — seluruhnya murni, tanpa menyentuh jaringan.
whatsappRoute.post("/pacing/preview", whatsappController.pacingPreview);
whatsappRoute.post("/typing/preview", whatsappController.typingPreview);
whatsappRoute.post("/throttle/preview", whatsappController.throttlePreview);
whatsappRoute.post("/presence", whatsappController.presence);
whatsappRoute.post("/phone", whatsappController.phone);
whatsappRoute.post("/media", whatsappController.media);

// Menyusun payload seperti yang akan dikirim Fonnte — dihitung, tidak dikirim.
whatsappRoute.post("/plan/preview", whatsappController.planPreview);

export default whatsappRoute;
