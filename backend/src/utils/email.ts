import { resend } from "@specific-dev/framework";

const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "CozinhaFast Pro <noreply@cozinhafastpro.app>";

/**
 * Send a password reset email to the user.
 * The email contains a deep link and token for manual entry.
 * @param to - User email address
 * @param token - Password reset token
 * @returns { sent: true } on success, { sent: false } on failure
 */
export async function sendPasswordResetEmail(to: string, token: string): Promise<{ sent: boolean }> {
  try {
    if (!resend) {
      console.warn("Resend is not configured - password reset email will not be sent");
      return { sent: false };
    }

    const deepLink = `cozinhafastpro://redefinir-senha?token=${encodeURIComponent(token)}`;

    const response = await resend.emails.send({
      from: RESEND_FROM_EMAIL,
      to,
      subject: "Redefinição de senha — CozinhaFast Pro",
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8" />
            <style>
              body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { text-align: center; margin-bottom: 30px; }
              .logo { font-size: 24px; font-weight: bold; color: #1f2937; margin-bottom: 10px; }
              .content { background: #f9fafb; border-radius: 8px; padding: 30px; margin-bottom: 20px; }
              .button { display: inline-block; background: #ef4444; color: white; padding: 12px 32px; border-radius: 6px; text-decoration: none; font-weight: 600; margin-bottom: 20px; }
              .token-box { background: #ffffff; border: 1px solid #e5e7eb; border-radius: 6px; padding: 15px; margin: 20px 0; font-family: monospace; text-align: center; font-size: 14px; }
              .note { font-size: 12px; color: #6b7280; margin: 15px 0; }
              .footer { text-align: center; font-size: 12px; color: #9ca3af; border-top: 1px solid #e5e7eb; padding-top: 20px; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <div class="logo">🍳 CozinhaFast Pro</div>
              </div>

              <div class="content">
                <h2 style="margin-top: 0; color: #1f2937;">Redefinir Senha</h2>

                <p>Você solicitou a redefinição de sua senha. Clique no botão abaixo para criar uma nova senha:</p>

                <center>
                  <a href="${deepLink}" class="button">Redefinir Minha Senha</a>
                </center>

                <p style="text-align: center; margin-bottom: 10px;"><strong>Ou use este código:</strong></p>
                <div class="token-box">${token}</div>

                <p class="note">
                  ⏱️ <strong>Este link e código expiram em 1 hora.</strong> Se não conseguir usar o link, copie e cole o código acima no app.
                </p>

                <p class="note">
                  🔒 Se você não solicitou a redefinição de senha, ignore este e-mail. Sua conta permanece segura.
                </p>
              </div>

              <div class="footer">
                <p>© 2026 CozinhaFast Pro. Todos os direitos reservados.</p>
                <p>Este é um e-mail automático. Por favor, não responda.</p>
              </div>
            </div>
          </body>
        </html>
      `,
    });

    if (response.error) {
      console.error("Failed to send password reset email:", response.error);
      return { sent: false };
    }

    return { sent: true };
  } catch (error) {
    console.error("Error sending password reset email:", error);
    return { sent: false };
  }
}
