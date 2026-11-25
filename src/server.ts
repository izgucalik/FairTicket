import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { ZodError } from "zod";
import "./db";
import { ApiError } from "./errors";
import { authRoutes } from "./routes/auth";
import { eventsRoutes } from "./routes/events";
import { ticketsRoutes } from "./routes/tickets";

const app = Fastify({ logger: true });

// Geliştirme sırasında her kaynaktan isteğe izin ver (frontend farklı portta çalışacak).
await app.register(cors, { origin: true });

// Tüm hatalar aynı biçimde döner: { error: { code, message } }
app.setErrorHandler((err: Error, _req, reply) => {
  if (err instanceof ApiError) {
    return reply.status(err.status).send({ error: { code: err.code, message: err.message } });
  }
  if (err instanceof ZodError) {
    return reply.status(400).send({ error: { code: "VALIDATION_ERROR", message: err.issues.map((i) => i.message).join("; ") } });
  }
  app.log.error(err);
  return reply.status(500).send({ error: { code: "INTERNAL", message: "Sunucu hatası" } });
});

app.get("/health", async () => ({ ok: true }));

await app.register(authRoutes);
await app.register(eventsRoutes);
await app.register(ticketsRoutes);

const port = Number(process.env.PORT ?? 3001);
await app.listen({ port, host: "0.0.0.0" });
