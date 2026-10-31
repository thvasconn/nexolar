# NexoLar: contexto do projeto (handoff)

Documento para passar o projeto para outro agente ou dev. Atualizado em 02/10/2026.

## 1. O produto

App mobile (iOS + Android) de **gestão familiar**, um "hub" da família: agenda, lista de compras com preços, receitas, eventos com rateio, localização, tarefas, metas, contas a pagar, mural de recados.

- **Nome provisório:** NexoLar. O nome vai mudar; o mockup mais recente do JV usa "nolare", ainda não confirmado. Não fixe o nome em identificadores (bundle id, slugs de banco etc.).
- **Modelo de negócio:** plano grátis e premium (assinatura por família via RevenueCat, depois), patrocínio e afiliados, e-mail marketing com opt-in.
- **Meta:** V1 até dezembro/2026 (gancho de Natal). Testes primeiro com as famílias da equipe.
- **Equipe:** Thiago (back-end e banco, dono deste repositório), João Victor "JV" (front-end e design), Pedro (redes e imprensa), Felipe (SEO), LA Comunicações (administração, conteúdo e patrocínio; paga as contas de loja e hospedagem).
- **Fontes de escopo, em ordem de prioridade:**
  1. decisões do Thiago nesta conversa (abaixo);
  2. transcrição e resumo da reunião de 28/09;
  3. os 3 PDFs na raiz. Os PDFs são **anteriores** à reunião e estão desatualizados. As telas deles são só conceito.

## 2. Escopo V1 (decidido)

**Dentro:**
- cadastro livre, família e perfis (pessoas, crianças, pets);
- home pessoal e home da família;
- agenda pessoal e familiar (período, participantes com aceitar/recusar, conflitos);
- aniversários;
- lista de compras com preço na hora e histórico colaborativo por mercado;
- receitas (privada, família ou pública, com denúncia);
- cardápio semanal;
- eventos (tipos, convidado externo, pratos, amigo oculto, rateio);
- tarefas;
- metas/hábitos (água, exercício, sono...);
- contas a pagar (lembrete com vencimento e responsável, **sem rateio de valor**);
- mural de recados;
- central de notificações;
- localização em tempo real;
- painel admin (web);
- notificações push (**ainda não feito**).

**Fora da V1:** finanças da casa com rateio e contribuições, viagens (V2), treino e bem-estar, saúde, B2B.

**Regras de negócio definidas:**
- Cadastro é livre. Todo usuário cria a própria família.
- **Convidar pessoa com login para a família é recurso premium.** Família grátis = dono + perfis sem login (e pets).
- A família é premium quando o **dono** tem assinatura ativa (`user_entitlements`).
- Limites (tabela `plan_limits`, valores provisórios):
  - grátis: 4 membros, 1 família própria, 3 eventos futuros, 20 receitas;
  - premium: 9 membros, 3 famílias, eventos e receitas ilimitados.
  - Pet não conta no limite.
- O admin da família **não vê** o que é privado dos outros (compromissos, tarefas e metas privadas).
- Localização: só a própria pessoa liga, família por família. Ao desligar, a última posição **fica salva mas invisível** para a família. Sem histórico de rota.
  - Desligar não gera aviso, push ou notificação para os demais. O mapa retira a posição na próxima consulta.
- Convidado externo de evento vê **só** aquele evento.
- Amigo oculto: cada um vê só quem tirou, inclusive quem sorteou.
- Dinheiro sempre em centavos (`bigint`). O rateio é calculado no servidor, com arredondamento pelo maior resto.

## 3. Stack

- **App:** Expo SDK 57 + React Native 0.86 + expo-router (rotas em `app/src/app/`), TypeScript. **Leia `app/AGENTS.md`:** o Expo muda muito, consulte a doc da versão antes de usar APIs.
- **Back-end:** Supabase (Postgres + Auth + Storage + Realtime + RLS). Não há API própria: o app fala direto com o Supabase, e **toda a segurança está no banco** (RLS e RPCs).
- **Futuro:** RevenueCat (assinatura), FCM/APNs (push), PostHog (analytics).
- **Painel admin:** `admin/` (Vite + React + TS). Até agora só o esqueleto; o código não foi escrito. As funções `admin_*` já existem no banco.

## 4. Estrutura do repositório

```
package.json                 scripts db:* (Supabase CLI local)
scripts/dev-relay.mjs        repasse de portas (ver seção 6)
supabase/config.toml         auth endurecido, portas 553xx
supabase/migrations/         10 migrations (ver seção 5)
supabase/templates/          e-mails com código de 6 dígitos (confirmação e recuperação)
supabase/tests/database/security.test.sql   pgTAP: segurança e regras de negócio
docs/SEGURANCA-PRODUCAO.md   checklist do que falta para produção
docs/HOME-FAMILIA-BACKEND.md contrato para o JV integrar fotos, reações e categorias
docs/LOCALIZACAO-BACKEND.md  contrato do mapa: consulta por família, posição, foto e consentimento
app/                         Expo
  src/app/(auth)/            entrar, cadastro, confirmar (código), esqueci
  src/app/(app)/(tabs)/      Eu (index), Família (familia-home), Agenda, Compras, Mais
  src/app/(app)/             demais telas (familia, membro/[id], perfil, notificacoes, tarefas,
                             cardapio, metas, contas, eventos, evento/*, receitas, receita/*,
                             lista/[id], compromisso/novo (criar e editar), localizacao...)
  src/app/convite/[token]    aceite de convite de família (fora do login)
  src/app/evento-convite/[token]
  src/lib/                   supabase (cliente + sessão criptografada), session, family (família atual),
                             format, goals, bills, events, recovery
  src/components/            ui.tsx (componentes básicos), bell.tsx (sino com contador)
admin/                       esqueleto Vite
```

O repositório git ainda **não tem nenhum commit**.

## 5. Banco (migrations)

1. **core:** perfis, famílias, membros, convites (só o hash do token, 7 dias, uso único), planos e assinatura, helpers de permissão no schema `private`, rate limit (`private.rate_limit`, `db_pre_request` com 120 escritas por minuto por usuário e retorno HTTP 429).
2. **food:** receitas, denúncias, mercados e produtos (catálogo compartilhado), listas e itens de compras, `price_observations` (gravadas ao finalizar a lista), RPC `price_board` (agregado anônimo).
3. **agenda_events:** `calendar_items` e participantes; eventos, participantes (e-mail do convidado não é legível pelo app), pratos, amigo oculto; RPCs `create_event_invite`, `accept_event_invite`, `claim_dish`, `draw_secret_santa`.
4. **event_costs:** `expenses`, `expense_shares`, RPC `add_expense` (igual, porcentagem, fixo), `event_balances`.
5. **location:** `location_shares`, `member_locations` (última posição).
6. **storage:** buckets privados `avatars`, `family-photos`, `recipe-photos`. A primeira pasta do caminho identifica o dono.
7. **admin:** `private.app_admins` e auditoria. Funções `admin_*` exigem estar na lista de admins **e** sessão com MFA (aal2).
8. **family_home:**
   - membros `kind` (pessoa/pet) e `color`; aceite de compromisso (`status`);
   - `tasks`, `meal_plan`, `goals` e `goal_logs`, `bills` e `bill_payments`, `family_notices`, `notifications`;
   - gatilhos que geram notificações;
   - `private.daily_notifications()` via pg_cron às 8h de Brasília (contas vencendo e aniversários).
9. **family_home_visuals:**
   - reações `heart`/`like` nos recados, uma por pessoa e tipo, com view de contadores que respeita RLS;
   - `events.cover_path` e bucket privado `event-photos`; convidado externo lê apenas a capa atual do evento aceito;
   - `family_members.photo_path` e bucket privado `member-photos`, para pessoas sem login e pets, gerenciados pelo admin;
   - `calendar_items.category`, com ícone definido pelo app;
   - contrato e exemplos em `docs/HOME-FAMILIA-BACKEND.md`, testes em `family_home_visuals.test.sql`.
10. **family_locations:**
    - RPC `family_locations(p_family_id)`: posições compartilhadas com a família consultada, nome, cor, foto, precisão e horários;
    - bloqueia também atualização da posição quando não há compartilhamento ativo em nenhuma família;
    - desligar preserva a última posição, sem gerar notificação; a próxima consulta deixa de retorná-la;
    - contrato em `docs/LOCALIZACAO-BACKEND.md`, testes em `family_locations.test.sql`.

**Regras de segurança do projeto (manter sempre):**
- Toda tabela em `public` com RLS ligado.
- `anon` não acessa nada.
- Grants explícitos, coluna a coluna.
- Funções `SECURITY DEFINER` com `search_path = ''`.
- Escritas com regra (dinheiro, convites, sorteio) só por RPC.

O teste pgTAP verifica tudo isso automaticamente.

## 6. Como rodar (dev local no WSL)

```bash
npm run db:start      # na raiz: Supabase local no Docker (API 55321, Studio 55323, Mailpit 55324)
npm run db:test       # 218 testes pgTAP, todos passando
cd app && npm run start:lan   # Expo + repasse de portas; ler o QR code com o Expo Go
```

- **Por que o repasse:** o WSL está em `networkingMode=mirrored`, que não expõe ao Windows nem ao celular as portas publicadas pelo Docker. O `scripts/dev-relay.mjs` expõe:
  - `54321` para a rede (a API, que o celular usa);
  - `54323` (Studio) e `54324` (Mailpit) só em `127.0.0.1`.
- `app/.env`: `EXPO_PUBLIC_SUPABASE_URL=http://192.168.15.4:54321` (IP do Windows na rede) e a publishable key local.
- `app/.env.local`: `EXPO_LAN_IP`.
- O celular precisa estar no **mesmo Wi-Fi**. O firewall do Windows e o Hyper-V já liberam 8081 e 54321.
- **Aplicar migration nova:** `npx supabase migration up`. **Não rode `db reset`** sem avisar o Thiago: ele apaga as contas de teste (Thiago e JV, "Familia Teste") e os dados que ele está usando no celular.
- **Dar premium a uma conta local:** Studio → SQL Editor, `insert into public.user_entitlements ...`. Ver o exemplo em `docs/SEGURANCA-PRODUCAO.md` e no histórico.

## 7. Estado do app (protótipo funcional, visual simples)

O visual é de propósito mínimo (`components/ui.tsx`). O design final é do JV. Tudo abaixo funciona de ponta a ponta com o banco:

- **Auth:** login, cadastro com código por e-mail, recuperação de senha por código. A sessão fica criptografada (chave AES no SecureStore, dado cifrado no AsyncStorage).
- **Eu:** tarefas do dia, compromissos de hoje, refeições do cardápio, metas com "+", próximos 7 dias, atalhos.
- **Família:** mural (fixar e apagar), eventos da semana, lista aberta, contas vencendo ("Paguei"), aniversários, atalhos.
- **Agenda:** Minha / Da família; Dia, Semana e Mês; cor por pessoa; conflitos; convites com aceitar e recusar; editar (dono) e apagar (dono ou admin).
- **Compras:** listas; itens com qtd. e preço; carrinho em tempo real; "mais barato recente"; finalizar com mercado.
- **Perfis da família**, **perfil individual** (admin muda papel, parentesco, cor e remove), **notificações** (filtros, confirmar, adiar, lida), tarefas, cardápio, metas, contas, eventos, receitas, localização (só em primeiro plano).

## 8. Pendências e próximos passos

1. **Mockup da home da família do JV** (`image.png` na raiz). Comparado com o implementado:
   - **Falta no mockup:** card da lista de compras, contas a pagar, troca de família, contador no sino, entrada para tarefas, metas, cardápio, contas e localização (a barra de baixo dele tem Início, Agenda, Eventos, Receitas, Compras), e onde fica a home pessoal "Eu".
   - **Back-end para o mockup implementado:** reações nos recados (❤️ 👍), foto de capa do evento, foto de membro sem login ou pet, categoria/ícone de compromisso. Falta o JV integrar esses campos e chamadas no front-end; ver `docs/HOME-FAMILIA-BACKEND.md`.
2. **Push** (FCM/APNs): a tabela `notifications` já existe; falta registrar o token do aparelho e disparar.
3. **Painel admin** em `admin/`: login, MFA (enroll e verify TOTP), métricas, denúncias, usuários (premium cortesia, bloqueio), limites de plano, auditoria.
4. **Webhook RevenueCat** (edge function) para gravar `user_entitlements`.
5. **Exclusão de conta** (LGPD e Apple). O dono de família precisa transferir ou apagar a família antes.
6. **Mapa e localização em segundo plano:** backend por família pronto (`docs/LOCALIZACAO-BACKEND.md`); falta integrar mapa com fotos, recepção Realtime independente do próprio compartilhamento, atualização silenciosa dos marcadores e GPS em segundo plano (development build).
7. **Recorrência de compromissos:** hoje é só um rótulo, não gera ocorrências.
8. **Rateio no app:** só divide igualmente; o banco já aceita porcentagem e valor fixo.
9. **Checklist de produção** em `docs/SEGURANCA-PRODUCAO.md`: projeto na região São Paulo, plano Pro, SMTP, MFA, PITR etc.

## 9. Preferências de trabalho do Thiago

- Português. Respostas diretas.
- Soluções simples, sem abstração desnecessária. Marque atalhos deliberados com o comentário `ponytail:` no código.
- **Segurança é prioridade:** toda regra nova no banco vem com teste pgTAP.
- Rode `npx tsc --noEmit` em `app/` e `npm run db:test` antes de dizer que terminou.
- Não faça commit sem ele pedir.
