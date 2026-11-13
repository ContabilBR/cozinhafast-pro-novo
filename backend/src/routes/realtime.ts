import type { App } from "../index.js";
import { realtimeHub } from "../realtime/hub.js";
import * as schema from "../db/schema/schema.js";
import { session as sessionTable, user as userTable } from "../db/schema/auth-schema.js";
import { eq, sql } from "drizzle-orm";

export function registerRealtimeRoutes(app: App) {
  const db = app.db as any;

  app.fastify.route({
    method: "GET",
    url: "/api/realtime",
    schema: {
      description: "WebSocket realtime event stream with token authentication",
      tags: ["realtime"],
    },
    wsHandler: (socket: any, request: any) => {
      app.logger.info({}, "WebSocket connection established");

      let connectionId: string | null = null;
      let isAuthenticated = false;
      const timeoutId = setTimeout(() => {
        if (!isAuthenticated) {
          app.logger.warn({}, "WebSocket auth timeout");
          socket.send(JSON.stringify({ error: "Authentication timeout" }));
          socket.close();
        }
      }, 5000);

      socket.on("message", async (rawMessage: any) => {
        try {
          if (isAuthenticated) {
            // Ignore further messages after authentication
            return;
          }

          let token: string;
          try {
            const message = JSON.parse(rawMessage.toString());
            token = message.token;
          } catch {
            // Fall back to treating message as plain token string
            token = rawMessage.toString();
          }

          if (!token || token.length === 0) {
            app.logger.warn({}, "Empty token received");
            socket.send(JSON.stringify({ error: "Token required" }));
            socket.close();
            clearTimeout(timeoutId);
            return;
          }

          // Check token in both session tables and get restaurante_id
          let restauranteId: string | null = null;
          let userId: string | null = null;
          try {
            // First, try custom auth: usuariosSession joined with usuarios
            const usuariosSessions = await db
              .select({
                userId: schema.usuariosSession.userId,
                expiresAt: schema.usuariosSession.expiresAt,
                restauranteId: schema.usuarios.restauranteId,
                ativo: schema.usuarios.ativo,
              })
              .from(schema.usuariosSession)
              .innerJoin(
                schema.usuarios,
                sql`${schema.usuarios.id}::text = ${schema.usuariosSession.userId}`
              )
              .where(eq(schema.usuariosSession.token, token))
              .limit(1);

            if (usuariosSessions && usuariosSessions.length > 0) {
              const sess = usuariosSessions[0];
              if (new Date(sess.expiresAt) < new Date()) {
                app.logger.warn({ token: token.substring(0, 10) }, "Expired custom session");
                socket.send(JSON.stringify({ error: "Invalid token" }));
                socket.close();
                clearTimeout(timeoutId);
                return;
              }

              // Check if user is inactive
              if (sess.ativo === false) {
                app.logger.warn({ restauranteId: sess.restauranteId, usuarioId: sess.userId }, "Inactive user in WebSocket");
                socket.send(JSON.stringify({ error: "Invalid token" }));
                socket.close();
                clearTimeout(timeoutId);
                return;
              }

              restauranteId = sess.restauranteId;
              userId = sess.userId;
              app.logger.debug({ token: token.substring(0, 10) }, "Authenticated via custom session");
            }

            // If not found in custom auth, try Better Auth session
            if (!restauranteId) {
              const betterAuthSessions = await db
                .select({
                  userId: sessionTable.userId,
                  expiresAt: sessionTable.expiresAt,
                })
                .from(sessionTable)
                .where(eq(sessionTable.token, token))
                .limit(1);

              if (betterAuthSessions && betterAuthSessions.length > 0) {
                const sess = betterAuthSessions[0];
                if (new Date(sess.expiresAt) < new Date()) {
                  app.logger.warn({ token: token.substring(0, 10) }, "Expired Better Auth session");
                  socket.send(JSON.stringify({ error: "Invalid token" }));
                  socket.close();
                  clearTimeout(timeoutId);
                  return;
                }

                // Get restaurante_id from user profile
                const profiles = await db
                  .select({ restauranteId: schema.profiles.restauranteId })
                  .from(schema.profiles)
                  .where(eq(schema.profiles.userId, sess.userId))
                  .limit(1);

                if (profiles && profiles.length > 0) {
                  restauranteId = profiles[0].restauranteId;
                  app.logger.debug({ token: token.substring(0, 10) }, "Authenticated via Better Auth session");
                } else {
                  app.logger.warn({ userId: sess.userId }, "No profile found for Better Auth user");
                  socket.send(JSON.stringify({ error: "Invalid token" }));
                  socket.close();
                  clearTimeout(timeoutId);
                  return;
                }
              }
            }

            if (!restauranteId) {
              app.logger.warn({ token: token.substring(0, 10) }, "Invalid token - not found in any session table");
              socket.send(JSON.stringify({ error: "Invalid token" }));
              socket.close();
              clearTimeout(timeoutId);
              return;
            }

            // Check if restaurant is inactive (but exempt platform restaurant)
            if (restauranteId !== '00000000000000') {
              const restauranteCheck = await db
                .select({ ativo: schema.restaurante.ativo })
                .from(schema.restaurante)
                .where(eq(schema.restaurante.id, restauranteId))
                .limit(1);
              if (restauranteCheck.length > 0 && restauranteCheck[0].ativo === false) {
                app.logger.warn({ restauranteId, usuarioId: userId }, "Inactive restaurant in WebSocket");
                socket.send(JSON.stringify({ error: "Invalid token" }));
                socket.close();
                clearTimeout(timeoutId);
                return;
              }
            }
          } catch (queryErr: any) {
            app.logger.error({ err: queryErr }, "Error querying token");
            socket.send(JSON.stringify({ error: "Authentication error" }));
            socket.close();
            clearTimeout(timeoutId);
            return;
          }

          isAuthenticated = true;
          clearTimeout(timeoutId);

          // Register connection with hub
          connectionId = realtimeHub.registerConnection(socket, restauranteId);
          app.logger.info({ restauranteId, connectionId }, "WebSocket authenticated");

          // Send connected message
          socket.send(JSON.stringify({ type: "connected", restauranteId }));
        } catch (err) {
          app.logger.error({ err }, "Error processing WebSocket message");
          socket.send(JSON.stringify({ error: "Internal error" }));
          socket.close();
        }
      });

      socket.on("close", () => {
        if (connectionId) {
          realtimeHub.deregisterConnection(connectionId);
          app.logger.info({ connectionId }, "WebSocket connection closed");
        }
      });

      socket.on("error", (err: any) => {
        app.logger.error({ err }, "WebSocket error");
        if (connectionId) {
          realtimeHub.deregisterConnection(connectionId);
        }
      });
    },
    handler: async (request: any, reply: any) => {
      return { protocol: "ws", path: "/api/realtime" };
    },
  });
}
