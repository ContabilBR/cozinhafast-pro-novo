ALTER TABLE "password_reset_tokens" DROP CONSTRAINT IF EXISTS "password_reset_tokens_usuario_id_usuarios_id_fk";--> statement-breakpoint
ALTER TABLE "usuarios" ALTER COLUMN "id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "usuarios" ALTER COLUMN "id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ALTER COLUMN "usuario_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "usuarios" ADD COLUMN "ativo" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "usuarios" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_email_unique" UNIQUE("email");--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE cascade;