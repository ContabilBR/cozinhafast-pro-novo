import type { App } from '../index.js';
import { eq } from 'drizzle-orm';
import * as schema from '../db/schema/schema.js';
import * as bcryptjs from 'bcryptjs';
import { randomUUID } from 'crypto';
import { ID_RESTAURANTE_PLATAFORMA } from '../utils/cnpj.js';

// Test Mode Configuration
export const TEST_MODE = process.env.TEST_MODE !== 'false'; // Default: true
export const TEST_ADMIN_EMAIL = 'admingeral@gmail.com';
export const TEST_ADMIN_PASSWORD = '123456';
export const TEST_ADMIN_NOME = 'Admin Geral';
export const TEST_RESTAURANTE_NOME = 'Plataforma (interno)';

/**
 * Seed test admin and restaurante at boot (only in TEST_MODE).
 * Idempotent: creates if not found, updates if exists.
 */
export async function seedTestAdmin(app: App): Promise<void> {
  if (!TEST_MODE) {
    app.logger.info('Test mode disabled, skipping test admin seed');
    return;
  }

  app.logger.info('Test mode enabled, seeding test admin and restaurante');

  try {
    // Step 1: Find or create test restaurante
    app.logger.debug('Looking for test restaurante');
    const restaurantes = await app.db
      .select()
      .from(schema.restaurante)
      .where(eq(schema.restaurante.nome, TEST_RESTAURANTE_NOME))
      .limit(1);

    let restauranteId: string;
    if (restaurantes.length > 0) {
      restauranteId = restaurantes[0].id;
      app.logger.info({ restauranteId }, 'Test restaurante found, reusing');
    } else {
      const newId = ID_RESTAURANTE_PLATAFORMA;
      const now = new Date();
      await app.db.insert(schema.restaurante).values({
        id: newId,
        nome: TEST_RESTAURANTE_NOME,
        plano: 'basico' as any,
        assinaturaStatus: 'ativa' as any,
        trialExpiraEm: null,
        ativo: true,
        ambienteFocus: 2,
        ncmPadrao: '21069090',
        createdAt: now,
        updatedAt: now,
      });
      restauranteId = newId;
      app.logger.info({ restauranteId }, 'Test restaurante created');
    }

    // Step 2: Find or create/update test admin usuario
    app.logger.debug('Looking for test admin usuario');
    const usuarios = await app.db
      .select()
      .from(schema.usuarios)
      .where(eq(schema.usuarios.email, TEST_ADMIN_EMAIL))
      .limit(1);

    const senhaHash = await bcryptjs.hash(TEST_ADMIN_PASSWORD, 10);
    const now = new Date();

    if (usuarios.length > 0) {
      // Update existing
      const usuarioId = usuarios[0].id;
      await app.db
        .update(schema.usuarios)
        .set({
          nome: TEST_ADMIN_NOME,
          senhaHash,
          role: 'administrador',
          restauranteId,
          ativo: true,
          updatedAt: now,
        })
        .where(eq(schema.usuarios.id, usuarioId));
      app.logger.info({ usuarioId, email: TEST_ADMIN_EMAIL }, 'Test admin usuario updated');
    } else {
      // Create new
      const usuarioId = randomUUID();
      await app.db.insert(schema.usuarios).values({
        id: usuarioId,
        nome: TEST_ADMIN_NOME,
        email: TEST_ADMIN_EMAIL,
        senhaHash,
        role: 'administrador',
        restauranteId,
        ativo: true,
        createdAt: now,
        updatedAt: now,
      });
      app.logger.info({ usuarioId, email: TEST_ADMIN_EMAIL }, 'Test admin usuario created');
    }
  } catch (error) {
    app.logger.error({ err: error }, 'Failed to seed test admin');
    throw error;
  }
}
