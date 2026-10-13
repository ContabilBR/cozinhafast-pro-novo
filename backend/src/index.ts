import { createApplication } from "@specific-dev/framework";
import * as appSchema from './db/schema/schema.js';
import * as authSchema from './db/schema/auth-schema.js';
import { seedTestAdmin } from './config/test-mode.js';
import { registerCustomAuthRoutes } from './routes/auth-custom.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerDishRoutes } from './routes/dishes.js';
import { registerTableRoutes } from './routes/tables.js';
import { registerOrderRoutes } from './routes/orders.js';
import { registerOrderItemRoutes } from './routes/order-items.js';
import { registerCategoriasRoutes } from './routes/categorias.js';
import { registerUsuariosRoutes } from './routes/usuarios.js';
import { registerRelatoriosRoutes } from './routes/relatorios.js';
import { registerGarconRoutes } from './routes/garcons.js';
import { registerHistoricoRoutes } from './routes/historico.js';
import { registerRestauranteRoutes } from './routes/restaurante.js';
import { registerRestauranteSignupRoutes } from './routes/restaurante-signup.js';
import { registerPagamentoRoutes } from './routes/pagamentos.js';
import { registerFiscalRoutes } from './routes/fiscal.js';
import { registerFiscalNfceRoutes } from './routes/fiscal-nfce.js';
import { registerAssinaturaRoutes } from './routes/assinatura.js';
import { registerLgpdRoutes } from './routes/lgpd.js';
import { registerDeliveryRoutes } from './routes/delivery.js';
import { registerRealtimeRoutes } from './routes/realtime.js';
import { registerCardapioPublicoRoutes } from './routes/cardapio-publico.js';
import { registerEstoqueRoutes } from './routes/estoque.js';
import { registerSuperAdminRoutes } from './routes/superadmin.js';
import { registerRenovacaoDeImagens } from './utils/imagem-assinada.js';
import { seedDatabase } from './db/seed.js';
import { enableSelectRetry } from './db/withRetry.js';
import { garantirColunasDeCancelamento, garantirColunasDeModoComanda } from './db/ensure-schema.js';
import { garantirRestauranteIdTexto } from './db/ensure-restaurante-id.js';

// Combine schemas
const schema = { ...appSchema, ...authSchema };

// Create application with schema for full database type support
export const app = await createApplication(schema);

// Add process-level error handlers for unhandled rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  app.logger.fatal({ reason, promise }, 'Unhandled promise rejection');
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  app.logger.fatal({ err: error }, 'Uncaught exception');
  process.exit(1);
});

// Enable automatic retry logic for all SELECT queries on connection errors
// This transparently handles transient connection failures without requiring
// changes to individual query call sites
enableSelectRetry(app.db);

// O id do restaurante é o CNPJ (texto): converte bancos antigos (uuid) antes de qualquer consulta
try {
  await garantirRestauranteIdTexto(app);
} catch (error) {
  app.logger.error({ err: error }, 'Failed to convert restaurante.id to text');
  throw error; // sem a conversão o código novo não funciona; melhor falhar na subida
}

// Garante as colunas de cancelamento de item (as migrações não rodam sozinhas no deploy)
try {
  await garantirColunasDeCancelamento(app);
} catch (error) {
  app.logger.error({ err: error }, 'Failed to ensure schema columns');
  // Don't exit - this is not critical
}

// Garante o modo de comanda do restaurante e o nome da comanda (comanda individual)
try {
  await garantirColunasDeModoComanda(app);
} catch (error) {
  app.logger.error({ err: error }, 'Failed to ensure modo_comanda columns');
  // Don't exit - this is not critical
}

// Seed test admin and restaurante if test mode is enabled
try {
  await seedTestAdmin(app);
} catch (error) {
  app.logger.error({ err: error }, 'Failed to seed test admin');
  // Don't exit - this is not critical
}

app.withStorage();

// Configure Better Auth with minimal settings
// The framework version doesn't expose additionalFields config
// Better Auth will auto-detect the user table columns (role, active)
app.withAuth();

// Export App type for use in route files
export type App = typeof app;

// Add global error handler for debugging - only catch unexpected errors
app.fastify.setErrorHandler((error: any, request, reply) => {
  // Let Fastify handle validation errors (FST_ERR_*) and other framework errors
  if (error.statusCode && error.statusCode < 500) {
    return reply.code(error.statusCode).send({ error: error.message });
  }

  // Log unexpected 5xx errors with full stack trace
  app.logger.error(
    {
      err: error,
      cause: error.cause, // Drizzle wraps the real driver/Postgres error here
      stack: error.stack,
      url: request.url,
      method: request.method,
    },
    'Global error handler'
  );
  console.error('Full error stack:', error.stack);
  if (error.cause) console.error('Underlying cause:', error.cause);

  // Never leak raw SQL, bound params, or driver internals to the client
  reply.code(500).send({ error: 'Erro interno do servidor. Tente novamente em instantes.' });
});

// Register routes - IMPORTANT: Always use registration functions to avoid circular dependency issues
// Register custom auth routes FIRST so they take priority
// Renova as URLs assinadas das fotos (valem só 15 min) em toda resposta. Deve vir ANTES das rotas.
registerRenovacaoDeImagens(app);

registerCustomAuthRoutes(app);
registerAuthRoutes(app);
registerDishRoutes(app);
registerTableRoutes(app);
registerOrderRoutes(app);
registerOrderItemRoutes(app);
registerCategoriasRoutes(app);
registerUsuariosRoutes(app);
registerRelatoriosRoutes(app);
registerGarconRoutes(app);
registerHistoricoRoutes(app);
registerRestauranteRoutes(app);
registerRestauranteSignupRoutes(app);
registerPagamentoRoutes(app);
registerFiscalRoutes(app);
registerFiscalNfceRoutes(app);
registerAssinaturaRoutes(app);
registerLgpdRoutes(app);
registerDeliveryRoutes(app);
registerRealtimeRoutes(app);
registerCardapioPublicoRoutes(app);
registerEstoqueRoutes(app);
registerSuperAdminRoutes(app);

// Seed database on startup (only if not in production and explicitly enabled)
if (process.env.NODE_ENV !== 'production' && process.env.SEED_ENABLED === 'true') {
  await seedDatabase(app);
}

try {
  app.logger.info('Starting application...');
  await app.run();
  app.logger.info('Application running successfully on port ' + (process.env.PORT || 3000));
} catch (error) {
  console.error('Fatal error during app.run():', error);
  app.logger.fatal({ err: error, stack: error instanceof Error ? error.stack : 'no stack' }, 'Fatal error during app.run()');
  process.exit(1);
}
