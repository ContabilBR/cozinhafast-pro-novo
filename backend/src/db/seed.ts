import { eq, sql } from "drizzle-orm";
import * as schema from "./schema/schema.js";
import { user as userTable, account as accountTable, session as sessionTable, verification as verificationTable } from "./schema/auth-schema.js";
import type { App } from "../index.js";
import { randomUUID } from "crypto";
import * as bcryptjs from "bcryptjs";

const seedAuthUsers = [
  {
    name: "Administrador",
    email: "admin@cozinhafast.com",
    password: process.env.SEED_ADMIN_PASSWORD ?? 'change-me-on-first-login',
    role: "administrador",
  },
  {
    name: "Gerente",
    email: "gerente@cozinhafast.com",
    password: process.env.SEED_GERENTE_PASSWORD ?? 'change-me-on-first-login',
    role: "gerente",
  },
  {
    name: "Gerente Teste",
    email: "gerente@teste.com",
    password: process.env.SEED_GERENTE_PASSWORD ?? 'change-me-on-first-login',
    role: "gerente",
  },
  {
    name: "Garçom",
    email: "garcom@cozinhafast.com",
    password: process.env.SEED_GARCOM_PASSWORD ?? 'change-me-on-first-login',
    role: "garcom",
  },
  {
    name: "Cozinheiro",
    email: "cozinheiro@cozinhafast.com",
    password: process.env.SEED_COZINHEIRO_PASSWORD ?? 'change-me-on-first-login',
    role: "cozinheiro",
  },
];

const seedCategorias = [
  { nome: "Entradas", descricao: "Aperitivos e entradas leves" },
  { nome: "Pratos Principais", descricao: "Pratos quentes e frios" },
  { nome: "Sobremesas", descricao: "Doces e sobremesas" },
  { nome: "Bebidas", descricao: "Bebidas quentes e frias" },
];

const seedPratos = [
  {
    nome: "Coxinha de Frango",
    descricao: "Coxinha crocante recheada com frango desfiado",
    preco: "12.90",
    categoria: "Entradas",
    imagemUrl: "https://picsum.photos/seed/prato1/400/300",
  },
  {
    nome: "Bolinho de Bacalhau",
    descricao: "Bolinho de bacalhau à Brás, crocante por fora macio por dentro",
    preco: "15.90",
    categoria: "Entradas",
    imagemUrl: "https://picsum.photos/seed/prato2/400/300",
  },
  {
    nome: "Pão de Alho",
    descricao: "Pão crocante com azeite e alho",
    preco: "8.90",
    categoria: "Entradas",
    imagemUrl: "https://picsum.photos/seed/prato3/400/300",
  },
  {
    nome: "Frango Grelhado",
    descricao: "Peito de frango grelhado com acompanhamentos",
    preco: "38.90",
    categoria: "Pratos Principais",
    imagemUrl: "https://picsum.photos/seed/prato4/400/300",
  },
  {
    nome: "Picanha na Brasa",
    descricao: "Picanha suculenta grelhada no fogo de chão",
    preco: "65.90",
    categoria: "Pratos Principais",
    imagemUrl: "https://picsum.photos/seed/prato5/400/300",
  },
  {
    nome: "Salmão ao Molho",
    descricao: "Salmão fresco ao molho de limão e manteiga",
    preco: "55.90",
    categoria: "Pratos Principais",
    imagemUrl: "https://picsum.photos/seed/prato6/400/300",
  },
  {
    nome: "Feijoada Completa",
    descricao: "Feijoada tradicional com acompanhamentos",
    preco: "42.90",
    categoria: "Pratos Principais",
    imagemUrl: "https://picsum.photos/seed/prato7/400/300",
  },
  {
    nome: "Pudim de Leite",
    descricao: "Pudim doce de leite condensado",
    preco: "14.90",
    categoria: "Sobremesas",
    imagemUrl: "https://picsum.photos/seed/prato8/400/300",
  },
  {
    nome: "Mousse de Chocolate",
    descricao: "Mousse aerado de chocolate belga",
    preco: "12.90",
    categoria: "Sobremesas",
    imagemUrl: "https://picsum.photos/seed/prato9/400/300",
  },
  {
    nome: "Suco de Laranja Natural",
    descricao: "Suco natural de laranja fresca",
    preco: "9.90",
    categoria: "Bebidas",
    imagemUrl: "https://picsum.photos/seed/prato10/400/300",
  },
];

const seedUsuarios = [
  { nome: "João Garçom", email: "garcom@cozinhafast.com", password: "123456", role: "garcom" },
  { nome: "Maria Cozinha", email: "cozinheiro@cozinhafast.com", password: "123456", role: "cozinha" },
  { nome: "Carlos Gerente", email: "gerente@cozinhafast.com", password: "123456", role: "gerente" },
  { nome: "Admin Sistema", email: "admin@cozinhafast.com", password: "123456", role: "admin" },
];

// Seed 4 core users that must always exist - using raw database inserts only
const seedUsers = [
  { email: "admin@cozinhafast.com", name: "Administrador", role: "admin", password: process.env.SEED_ADMIN_PASSWORD ?? 'change-me-on-first-login' },
  { email: "gerente@cozinhafast.com", name: "Gerente", role: "gerente", password: process.env.SEED_GERENTE_PASSWORD ?? 'change-me-on-first-login' },
  { email: "garcom@cozinhafast.com", name: "Garçom", role: "garcom", password: process.env.SEED_GARCOM_PASSWORD ?? 'change-me-on-first-login' },
  { email: "cozinheiro@cozinhafast.com", name: "Cozinheiro", role: "cozinheiro", password: process.env.SEED_COZINHEIRO_PASSWORD ?? 'change-me-on-first-login' },
];

export async function seedDatabase(app: App) {
  try {
    app.logger.info("Starting database seed");

    // Ensure seed restaurante exists with specific ID and CNPJ
    let seedRestauranteId: string;
    const seedRestauranteSpecificId = '52893314000164';

    try {
      // Try to upsert the specific seed restaurante with the CNPJ
      const [r] = await app.db.insert(schema.restaurante).values({
        id: seedRestauranteSpecificId,
        nome: 'Cozinha Fast Pro',
        cnpj: '52893314000164',
      }).onConflictDoUpdate({
        target: schema.restaurante.id,
        set: {
          nome: 'Cozinha Fast Pro',
          cnpj: '52893314000164',
        },
      }).returning();
      seedRestauranteId = r.id;
    } catch (err) {
      app.logger.warn({ err }, "Failed to upsert seed restaurante with specific ID, falling back to first restaurante");
      const existingRestaurante = await app.db.select().from(schema.restaurante).limit(1);
      if (existingRestaurante.length > 0) {
        // Update CNPJ in fallback path
        await app.db.update(schema.restaurante).set({ cnpj: '52893314000164', nome: 'Cozinha Fast Pro' }).where(eq(schema.restaurante.id, existingRestaurante[0].id));
        seedRestauranteId = existingRestaurante[0].id;
      } else {
        const [r] = await app.db.insert(schema.restaurante).values({
          id: '52893314000164',
          nome: 'Cozinha Fast Pro',
          cnpj: '52893314000164',
        }).returning();
        seedRestauranteId = r.id;
      }
    }

    // Force-correct CNPJ on every startup — runs unconditionally
    try {
      await (app.db as any).execute(
        `UPDATE restaurante SET cnpj = '52893314000164', nome = 'Cozinha Fast Pro' WHERE id = '52893314000164'`
      );
      app.logger.info("Force-corrected restaurante CNPJ to 52893314000164");
    } catch (forceErr) {
      app.logger.warn({ err: forceErr }, "Failed to force-correct restaurante CNPJ");
    }

    app.logger.info({ seedRestauranteId }, "Seed restaurante resolved");

    // Step 1: Ensure all enum values exist using raw SQL
    app.logger.info("Ensuring user_role enum values exist");
    try {
      const enumValues = ["admin", "gerente", "garcom", "cozinheiro", "administrador"];

      for (const value of enumValues) {
        try {
          const query = `
            DO $$
            BEGIN
              ALTER TYPE user_role ADD VALUE IF NOT EXISTS '${value}';
            EXCEPTION WHEN others THEN NULL;
            END$$;
          `;
          // Try to execute raw SQL if the method exists
          if (typeof (app.db as any).execute === 'function') {
            await (app.db as any).execute(query);
          }
        } catch (err) {
          app.logger.debug({ value, err }, "Failed to add enum value (may already exist)");
        }
      }

      app.logger.info("Enum values ensured");
    } catch (err) {
      app.logger.warn({ err }, "Failed to ensure enum values");
    }

    // Step 2: Upsert seed users (preserve existing users, never delete)
    app.logger.info("Upserting seed users");
    const now = new Date();

    try {
      // Upsert each seed user: only insert if email doesn't exist
      app.logger.info({ count: seedUsers.length }, "Upserting seed users with INSERT ... ON CONFLICT");

      for (const seedUser of seedUsers) {
        try {
          const existing = await app.db
            .select({ id: userTable.id })
            .from(userTable)
            .where(eq(userTable.email, seedUser.email))
            .limit(1);

          if (existing.length === 0) {
            const userId = randomUUID();

            // Insert into user table (will be unique by email)
            await app.db.insert(userTable).values({
              id: userId,
              name: seedUser.name,
              email: seedUser.email,
              emailVerified: true,
              role: seedUser.role as any,
              active: true,
              createdAt: now,
              updatedAt: now,
            });

            app.logger.debug({ email: seedUser.email, userId }, "Created new seed user");

            // Hash password and insert into account table
            const hashedPassword = bcryptjs.hashSync(seedUser.password, 10);

            await app.db.insert(accountTable).values({
              id: randomUUID(),
              accountId: seedUser.email,
              providerId: "credential",
              userId: userId,
              password: hashedPassword,
              createdAt: now,
              updatedAt: now,
            });

            app.logger.debug({ email: seedUser.email }, `Seed user created: ${seedUser.email}`);
          } else {
            app.logger.debug({ email: seedUser.email }, "Seed user already exists, skipping");
          }
        } catch (err) {
          app.logger.warn({ email: seedUser.email, err }, "Failed to upsert seed user");
        }
      }

      app.logger.info("Seed users upserted successfully");

      // Step 2a: Create profiles for seeded users
      app.logger.info("Creating profiles for seeded users");
      try {
        for (const seedUser of seedUsers) {
          try {
            const user = await app.db
              .select({ id: userTable.id })
              .from(userTable)
              .where(eq(userTable.email, seedUser.email))
              .limit(1);

            if (user.length > 0) {
              // Check if profile exists
              const existingProfile = await app.db
                .select()
                .from(schema.profiles)
                .where(eq(schema.profiles.userId, user[0].id))
                .limit(1);

              if (existingProfile.length === 0) {
                // Create profile with seed restaurante
                await app.db.insert(schema.profiles).values({
                  userId: user[0].id,
                  restauranteId: seedRestauranteId,
                  role: seedUser.role,
                  name: seedUser.name,
                  createdAt: now,
                });
                app.logger.debug({ email: seedUser.email, userId: user[0].id }, "Created profile for seed user");
              }
            }
          } catch (err) {
            app.logger.warn({ email: seedUser.email, err }, "Failed to create profile for seed user");
          }
        }
        app.logger.info("Profiles created successfully");
      } catch (err) {
        app.logger.warn({ err }, "Failed to create profiles for seed users");
      }
    } catch (err) {
      app.logger.error({ err }, "Failed to upsert seed users");
      throw err;
    }

    // Step 2b: Upsert seed usuarios (preserve existing real user accounts across deploys)
    app.logger.info("Upserting seed usuarios");

    try {
      // Hash password at runtime
      const senhaHash = bcryptjs.hashSync(process.env.SEED_ADMIN_PASSWORD ?? 'change-me-on-first-login', 10);
      app.logger.info({ hashLength: senhaHash.length, hashStart: senhaHash.substring(0, 20) }, 'Password hashed for seed');

      // Prepare seed data
      const seedUsuariosData = [
        { nome: 'Administrador', email: 'admin@cozinhafast.com', role: 'admin' },
        { nome: 'Gerente', email: 'gerente@cozinhafast.com', role: 'gerente' },
        { nome: 'Garçom', email: 'garcom@cozinhafast.com', role: 'garcom' },
        { nome: 'Cozinheiro', email: 'cozinheiro@cozinhafast.com', role: 'cozinheiro' },
      ];

      // Upsert each usuario with raw SQL to preserve existing senha_hash
      app.logger.info({ count: seedUsuariosData.length }, "Upserting seed usuarios with INSERT ... ON CONFLICT");

      for (const u of seedUsuariosData) {
        try {
          // Check if usuario exists
          const existing = await app.db
            .select()
            .from(schema.usuarios)
            .where(eq(schema.usuarios.email, u.email))
            .limit(1);

          if (existing.length === 0) {
            // Insert new usuario with hashed password
            await app.db.insert(schema.usuarios).values({
              id: randomUUID(),
              nome: u.nome,
              email: u.email,
              senhaHash: senhaHash,
              role: u.role,
              restauranteId: seedRestauranteId,
              ativo: true,
              createdAt: new Date(),
              updatedAt: new Date(),
            });
            app.logger.debug({ email: u.email }, 'Inserted new seed usuario');
          } else {
            // User already exists - preserve existing senha_hash if present
            const existingUser = existing[0];
            if (!existingUser.senhaHash) {
              // Only update senha_hash if it's NULL
              await app.db
                .update(schema.usuarios)
                .set({ senhaHash: senhaHash })
                .where(eq(schema.usuarios.email, u.email));
              app.logger.debug({ email: u.email }, 'Updated NULL senha_hash for existing usuario');
            } else {
              app.logger.debug({ email: u.email }, 'Seed usuario already exists with senha_hash, preserving it');
            }
          }
        } catch (err) {
          app.logger.warn({ email: u.email, err }, 'Failed to upsert usuario');
        }
      }

      app.logger.info("Seed usuarios upserted successfully");

      // Startup migration: Fix es@gmail.com with default password if senha_hash is NULL
      app.logger.info("Running startup migration: fixing NULL senha_hash for es@gmail.com");
      try {
        const esUser = await app.db
          .select()
          .from(schema.usuarios)
          .where(eq(schema.usuarios.email, 'es@gmail.com'))
          .limit(1);

        if (esUser.length > 0 && esUser[0].senhaHash === null) {
          // Hash the default password with bcrypt cost factor 10
          const defaultHash = bcryptjs.hashSync(process.env.SEED_GARCOM_PASSWORD ?? 'change-me-on-first-login', 10);

          await app.db
            .update(schema.usuarios)
            .set({ senhaHash: defaultHash })
            .where(eq(schema.usuarios.email, 'es@gmail.com'));

          app.logger.info(
            { email: 'es@gmail.com' },
            'Set default password (garcom123) for es@gmail.com'
          );
        } else if (esUser.length > 0 && esUser[0].senhaHash) {
          app.logger.debug({ email: 'es@gmail.com' }, 'es@gmail.com already has senha_hash, skipping migration');
        } else {
          app.logger.debug({ email: 'es@gmail.com' }, 'es@gmail.com user not found');
        }
      } catch (err) {
        app.logger.warn({ err }, 'Failed to run startup migration for es@gmail.com');
      }

      // Verify
      const allUsuarios = await app.db.select().from(schema.usuarios);
      app.logger.info({ count: allUsuarios.length }, 'Usuarios verified');

      allUsuarios.forEach((u, idx) => {
        app.logger.debug({
          index: idx,
          email: u.email,
          hasPassword: !!u.senhaHash,
          hashLength: u.senhaHash?.length || 0
        }, 'Seeded usuario');
      });
    } catch (err) {
      app.logger.error({ err }, 'Failed to upsert seed usuarios');
    }

    // Mesas não são semeadas automaticamente: a quantidade de mesas é definida pelo
    // próprio restaurante através da tela de Gestão (POST/PUT/DELETE /api/mesas já
    // cobrem isso). Um conjunto fixo de 20 mesas aqui não reflete a realidade de
    // nenhum restaurante real, e a versão anterior desse bloco também tinha um bug
    // sério: contava mesas da tabela inteira (sem filtrar por tenant) e, acima de um
    // limite, apagava pedidos/comandas/mesas globalmente e reinseria 20 mesas mesmo
    // quando essa limpeza falhava — o que criava mesas "fantasma" 1-20 por cima dos
    // dados reais a cada reinício do backend.

    // Seed categorias with upsert
    app.logger.info("Seeding categorias");
    const categoriaIds: Record<string, string> = {};
    for (const cat of seedCategorias) {
      try {
        const existing = await app.db
          .select()
          .from(schema.categorias)
          .where(eq(schema.categorias.nome, cat.nome))
          .limit(1);

        if (existing.length > 0) {
          categoriaIds[cat.nome] = existing[0].id;
        } else {
          const [categoria] = await app.db
            .insert(schema.categorias)
            .values({
              nome: cat.nome,
              descricao: cat.descricao,
              restauranteId: seedRestauranteId,
            })
            .returning();
          categoriaIds[cat.nome] = categoria.id;
        }
      } catch (err) {
        app.logger.warn({ categoria: cat.nome, err }, "Failed to seed categoria");
      }
    }
    app.logger.info("Categorias seeded successfully");

    // Seed pratos with upsert
    app.logger.info("Seeding pratos");
    for (const prato of seedPratos) {
      try {
        const existing = await app.db
          .select()
          .from(schema.pratos)
          .where(eq(schema.pratos.nome, prato.nome))
          .limit(1);

        if (existing.length === 0) {
          await app.db.insert(schema.pratos).values({
            nome: prato.nome,
            descricao: prato.descricao,
            preco: prato.preco,
            categoriaId: categoriaIds[prato.categoria],
            imagemUrl: prato.imagemUrl,
            disponivel: true,
            restauranteId: seedRestauranteId,
          });
        }
      } catch (err) {
        app.logger.warn({ prato: prato.nome, err }, "Failed to seed prato");
      }
    }
    app.logger.info("Pratos seeded successfully");

    // Startup diagnostics: Check mesa status enum values and actual data
    app.logger.info("Running mesa status diagnostics...");
    try {
      // Query the database enum catalog to find mesa_status enum values
      const enumQuery = sql`
        SELECT enumlabel
        FROM pg_enum
        WHERE enumtypid = (
          SELECT oid FROM pg_type WHERE typname = 'mesa_status'
        )
        ORDER BY enumsortorder;
      `;

      const enumResults = await (app.db as any).execute(enumQuery) as any[];
      const validEnumValues = enumResults.map((r: any) => r.enumlabel);
      app.logger.info({ enumValues: validEnumValues }, "Mesa status enum values:");

      // Query distinct status values currently in the mesas table
      const distinctStatusQuery = sql`SELECT DISTINCT status FROM mesas ORDER BY status;`;
      const distinctResults = await (app.db as any).execute(distinctStatusQuery) as any[];
      const currentStatuses = distinctResults.map((r: any) => r.status);
      app.logger.info({ currentStatuses }, "Distinct status values in mesas table:");

      // Sync mesa statuses based on open comandas - use 'disponivel' for no open comandas, 'ocupada' for open
      app.logger.info("Running mesa status synchronization migration");
      try {
        // Set all mesas without an open comanda to 'disponivel'
        const updateAvailableResult = await (app.db as any).execute(
          sql`UPDATE mesas SET status = 'disponivel' WHERE id NOT IN (SELECT DISTINCT mesa_id FROM comandas WHERE status = 'aberta')`
        );
        const availableCount = updateAvailableResult?.rowCount || 0;

        // Set all mesas with at least one open comanda to 'ocupada'
        const updateOccupiedResult = await (app.db as any).execute(
          sql`UPDATE mesas SET status = 'ocupada' WHERE id IN (SELECT DISTINCT mesa_id FROM comandas WHERE status = 'aberta')`
        );
        const occupiedCount = updateOccupiedResult?.rowCount || 0;

        app.logger.info({ availableUpdated: availableCount, occupiedUpdated: occupiedCount }, "Mesa status synchronization completed successfully");
      } catch (err) {
        app.logger.warn({ err }, "Mesa status synchronization failed");
      }

      // Startup migration: Release any mesas that don't have comanda references
      app.logger.info("Running startup migration: releasing mesas with no comanda references");
      try {
        const fixStuckMesasResult = await (app.db as any).execute(
          sql`UPDATE mesas SET status = 'disponivel' WHERE id NOT IN (SELECT DISTINCT mesa_id FROM comandas WHERE mesa_id IS NOT NULL)`
        );
        const rowsUpdated = fixStuckMesasResult?.rowCount || 0;
        app.logger.info({ rowsUpdated }, "Startup migration: released mesas with no comanda references");
      } catch (err) {
        app.logger.warn({ err }, "Startup migration: failed to release mesas");
      }

      // Startup migration: Add subtotal and gorjeta columns if they don't exist
      app.logger.info("Running migration: adding subtotal/gorjeta columns");
      try {
        await (app.db as any).execute(
          sql`ALTER TABLE comandas ADD COLUMN IF NOT EXISTS subtotal NUMERIC NOT NULL DEFAULT 0`
        );
        await (app.db as any).execute(
          sql`ALTER TABLE comandas ADD COLUMN IF NOT EXISTS gorjeta NUMERIC NOT NULL DEFAULT 0`
        );
        await (app.db as any).execute(
          sql`ALTER TABLE comandas_historico ADD COLUMN IF NOT EXISTS subtotal NUMERIC NOT NULL DEFAULT 0`
        );
        await (app.db as any).execute(
          sql`ALTER TABLE comandas_historico ADD COLUMN IF NOT EXISTS gorjeta NUMERIC NOT NULL DEFAULT 0`
        );

        // Backfill: for rows with no gorjeta, assume subtotal = total
        await (app.db as any).execute(
          sql`UPDATE comandas SET subtotal = total WHERE subtotal = 0 AND total > 0`
        );
        await (app.db as any).execute(
          sql`UPDATE comandas_historico SET subtotal = total WHERE subtotal = 0 AND total > 0`
        );

        app.logger.info("Migration: subtotal/gorjeta columns added and backfilled");
      } catch (err) {
        app.logger.warn({ err }, "Migration: subtotal/gorjeta columns already exist or failed");
      }
    } catch (err) {
      app.logger.warn({ err }, "Mesa status diagnostics failed");
    }

    // Migration: Consolidate categories from categoria_pratos to categorias
    app.logger.info("Running category consolidation migration");
    try {
      // Get all categories from categoria_pratos that don't exist in categorias
      const categoriaPratosList = await app.db.select().from(schema.categoriaPratos);

      for (const cp of categoriaPratosList) {
        try {
          // Check if this category already exists in categorias by nome
          const existing = await app.db
            .select()
            .from(schema.categorias)
            .where(eq(schema.categorias.nome, cp.nome))
            .limit(1);

          if (existing.length === 0) {
            // Insert missing category
            const [newCat] = await app.db
              .insert(schema.categorias)
              .values({
                nome: cp.nome,
                descricao: cp.descricao,
                restauranteId: seedRestauranteId,
              })
              .returning();

            app.logger.debug({ categoryNome: cp.nome, newId: newCat.id }, "Migrated category from categoria_pratos");
          }
        } catch (err) {
          app.logger.debug({ categoryNome: cp.nome, err }, "Failed to migrate category");
        }
      }

      // Update any pratos that reference categoria_pratos IDs to reference categorias instead
      const pratosWithoutCategoria = await app.db
        .select()
        .from(schema.pratos)
        .where(eq(schema.pratos.categoriaId, null));

      app.logger.info({ count: categoriaPratosList.length }, "Category consolidation completed");
    } catch (err) {
      app.logger.warn({ err }, "Category consolidation migration failed or not needed");
    }

    // Fix missing images
    app.logger.info("Fixing missing prato images");
    try {
      const pratosWithoutImages = await app.db
        .select()
        .from(schema.pratos)
        .where(sql`${schema.pratos.imagemUrl} IS NULL`);

      const imageMap: Record<string, string> = {
        bruschetta: "https://images.unsplash.com/photo-1572695157366-5e585ab2b69f?w=400&q=80",
        frango: "https://images.unsplash.com/photo-1598103442097-8b74394b95c3?w=400&q=80",
        chicken: "https://images.unsplash.com/photo-1598103442097-8b74394b95c3?w=400&q=80",
        carne: "https://images.unsplash.com/photo-1546833999-b9f581a1996d?w=400&q=80",
        bife: "https://images.unsplash.com/photo-1546833999-b9f581a1996d?w=400&q=80",
        steak: "https://images.unsplash.com/photo-1546833999-b9f581a1996d?w=400&q=80",
        peixe: "https://images.unsplash.com/photo-1519708227418-c8fd9a32b7a2?w=400&q=80",
        fish: "https://images.unsplash.com/photo-1519708227418-c8fd9a32b7a2?w=400&q=80",
        salm: "https://images.unsplash.com/photo-1519708227418-c8fd9a32b7a2?w=400&q=80",
        massa: "https://images.unsplash.com/photo-1621996346565-e3dbc646d9a9?w=400&q=80",
        macarr: "https://images.unsplash.com/photo-1621996346565-e3dbc646d9a9?w=400&q=80",
        pasta: "https://images.unsplash.com/photo-1621996346565-e3dbc646d9a9?w=400&q=80",
        pizza: "https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=400&q=80",
        salada: "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=400&q=80",
        salad: "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=400&q=80",
        suco: "https://images.unsplash.com/photo-1600271886742-f049cd451bba?w=400&q=80",
        juice: "https://images.unsplash.com/photo-1600271886742-f049cd451bba?w=400&q=80",
        laranja: "https://images.unsplash.com/photo-1600271886742-f049cd451bba?w=400&q=80",
        manga: "https://images.unsplash.com/photo-1600271886742-f049cd451bba?w=400&q=80",
        cerveja: "https://images.unsplash.com/photo-1608270586620-248524c67de9?w=400&q=80",
        beer: "https://images.unsplash.com/photo-1608270586620-248524c67de9?w=400&q=80",
        sobremesa: "https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=400&q=80",
        doce: "https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=400&q=80",
        bolo: "https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=400&q=80",
        cake: "https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=400&q=80",
      };

      for (const prato of pratosWithoutImages) {
        try {
          let imageUrl = `https://picsum.photos/seed/${prato.id}/400/300`;

          // Try to match the prato nome to find an image
          const lowerNome = prato.nome.toLowerCase();
          for (const [keyword, url] of Object.entries(imageMap)) {
            if (lowerNome.includes(keyword)) {
              imageUrl = url;
              break;
            }
          }

          await app.db
            .update(schema.pratos)
            .set({ imagemUrl: imageUrl })
            .where(eq(schema.pratos.id, prato.id));
        } catch (err) {
          app.logger.debug({ pratoId: prato.id, err }, "Failed to update prato image");
        }
      }

      app.logger.info({ count: pratosWithoutImages.length }, "Fixed missing prato images");
    } catch (err) {
      app.logger.warn({ err }, "Failed to fix missing images");
    }

    app.logger.info("Database seeded successfully");
  } catch (error) {
    app.logger.error({ err: error }, "Failed to seed database");
  }
}
