# Segurança: pendências para produção

O que já está no código (RLS, grants, limite de requisições, storage, admin com MFA) é testado por `npm run db:test`.
Esta lista é do que depende de configurar o projeto Supabase de produção ou de serviços pagos.

## Antes do beta (famílias de teste)

- [ ] Criar o projeto na região **São Paulo (sa-east-1)**.
- [ ] Plano **Pro** (o grátis pausa por inatividade e não tem backup).
- [ ] Aplicar as migrations com `supabase db push`, nunca editando tabelas pelo painel.
- [ ] **SMTP próprio** (Resend, SES ou similar) com domínio do app, SPF, DKIM e DMARC. O SMTP padrão do Supabase só envia poucos e-mails por hora.
- [ ] Copiar os templates de `supabase/templates/` para Auth > Email Templates (confirmação e recuperação por código).
- [ ] Auth > Settings: conferir as mesmas regras do `config.toml` (senha de 10+ caracteres com maiúscula, minúscula e número; confirmação de e-mail; reautenticação para trocar senha).
- [ ] Auth > **Leaked password protection** (bloqueia senhas que já vazaram; só no Pro).
- [ ] Auth > Rate limits: revisar os limites de cadastro, login e envio de e-mail.
- [ ] Ativar **MFA (TOTP)**, obrigatório para o painel admin.
- [ ] Cadastrar os admins: `insert into private.app_admins (user_id) values ('<uuid>');`
- [ ] Rodar o **Security Advisor** e o **Performance Advisor** do painel e zerar os alertas.
- [ ] Guardar a `service_role key` só em cofre (1Password/Bitwarden) e nas edge functions. Nunca no app, no painel admin ou no git.

## Antes do lançamento público

- [ ] **Backup contínuo (PITR)** e um teste de restauração documentado.
- [ ] **Network restrictions**: liberar conexão direta ao Postgres só para IPs da equipe/CI.
- [ ] **SSL enforcement** ligado.
- [ ] **MFA na conta da organização** Supabase para todos da equipe, e remover quem não precisa de acesso.
- [ ] **CAPTCHA** no cadastro (hCaptcha ou Turnstile, integrado no Auth) se aparecer cadastro em massa.
- [ ] Domínio próprio para a API (custom domain), opcional.
- [ ] Alertas: uso de banco, erros 5xx, picos de 429.
- [ ] Política de privacidade e termos publicados (LGPD), com o contato do encarregado de dados.
- [ ] Fluxo de **exclusão de conta** no app (exigência da Apple e da LGPD). O dono de família precisa transferir ou apagar a família antes.
- [ ] Webhook do **RevenueCat** (edge function) gravando `user_entitlements`, validando a assinatura do webhook.

## Rotina

- [ ] Revisar a auditoria do admin (`admin_audit_log`) todo mês.
- [ ] Rodar o Security Advisor a cada migration nova.
- [ ] Atualizar dependências do app e do painel todo mês (`npm audit`).
