import type { FastifyInstance } from "fastify";

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    const status = error.statusCode ?? 500;
    if (status >= 500) {
      request.log.error({ err: error }, "Unhandled server error");
      return reply
        .code(500)
        .send({ error: "INTERNAL_ERROR", message: "An unexpected error occurred" });
    }
    return reply.code(status).send({
      error: (error as { code?: string }).code ?? "REQUEST_ERROR",
      message: error.message,
    });
  });
}
