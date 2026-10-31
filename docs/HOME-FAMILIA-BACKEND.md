# Backend da home da família (mockup do JV)

Implementado pela migration `20260930000009_family_home_visuals.sql`.
O app continua falando direto com o Supabase, usando a sessão do usuário.

## Reações nos recados

`family_notice_reactions` registra `notice_id`, `user_id`, `reaction` e `created_at`.
`user_id` e `created_at` são preenchidos pelo banco: envie apenas
`notice_id` e `reaction` (`heart` para ❤️, `like` para 👍).
Cada pessoa pode marcar os dois tipos, uma vez cada, em cada recado.
Só membros atuais da família leem ou reagem, e cada um só remove suas próprias reações.

```ts
// Marcar. Uma repetição retorna 23505; não aumenta o contador.
const { error } = await supabase.from('family_notice_reactions').insert({
  notice_id: noticeId,
  reaction: 'heart',
});

// Desmarcar. O userId vem da sessão atual; o RLS confere a autoria.
await supabase.from('family_notice_reactions').delete()
  .eq('notice_id', noticeId)
  .eq('reaction', 'heart')
  .eq('user_id', userId);

// Contadores calculados no banco, incluindo recados com zero reações.
const { data: counts } = await supabase.from('family_notice_reaction_counts')
  .select('notice_id, heart_count, like_count, hearted_by_me, liked_by_me')
  .eq('family_id', familyId)
  .in('notice_id', noticeIds);
```

A view usa `security_invoker`: mantém o RLS dos recados e das reações.
`hearted_by_me` e `liked_by_me` são relativos à sessão que faz a consulta.
Atualize os contadores ao abrir a tela e depois de marcar/desmarcar.
A tabela de reações não foi adicionada à publicação Realtime; os recados continuam
na publicação existente. Reações são removidas em cascata quando o recado é apagado.

## Fotos

Os novos buckets são privados, aceitam JPEG, PNG, WebP e HEIC, até 5 MB.
Crie primeiro o registro para obter o ID, envie o arquivo e então atualize o campo.
Não grave URL assinada no banco: ela expira. Grave o caminho relativo.

| Uso | Bucket | Caminho | Campo | Quem envia/edita |
| --- | --- | --- | --- | --- |
| Capa de evento | `event-photos` | `<event_id>/<arquivo>` | `events.cover_path` | Membro da família do evento |
| Pessoa sem login ou pet | `member-photos` | `<member_id>/<arquivo>` | `family_members.photo_path` | Admin da família |
| Pessoa com login (já existia) | `avatars` | `<user_id>/<arquivo>` | `profiles.avatar_path` | A própria pessoa |

O banco rejeita caminhos de outro evento/membro, caminhos sem arquivo, caminhos
com mais de 300 caracteres e `photo_path` em membros com login.
Membros da família leem as fotos da sua família. Convidados externos, depois de
aceitar, leem **somente o arquivo apontado pela capa atual daquele evento**;
não leem capas antigas, outros eventos nem fotos de membros/pets.
Ao sair da família ou ser removido do evento, novas leituras são negadas.
Uma URL assinada já emitida permanece utilizável até expirar; use validade curta.

```ts
const path = `${eventId}/${Date.now()}.jpg`;
const { error: uploadError } = await supabase.storage.from('event-photos')
  .upload(path, imageBody, { contentType: 'image/jpeg' });
if (uploadError) throw uploadError;

const { error: saveError } = await supabase.from('events')
  .update({ cover_path: path }).eq('id', eventId);
if (saveError) throw saveError;

const { data: signed, error: signError } = await supabase.storage
  .from('event-photos').createSignedUrl(path, 300);
if (signError) throw signError;
// Exibir signed.signedUrl; renovar quando expirar.
```

Para membros/pets, faça o mesmo com `member-photos` e atualize `photo_path`.
Na faixa de perfis, use `profiles.avatar_path` quando `user_id` estiver preenchido;
nos demais casos, use `family_members.photo_path`.

Para retirar uma foto, primeiro limpe o campo (`null`) e depois remova o arquivo
usando `supabase.storage.from(bucket).remove([path])`. Para trocar, envie com
um nome novo e atualize o campo antes de remover o arquivo antigo.
Apagar o registro não remove automaticamente o arquivo físico do Storage.
Trate erros de todas as chamadas no código da tela.

## Categoria e ícone dos compromissos

`calendar_items.category` é obrigatório, com padrão `other`, preservando o código
atual. O dono do compromisso pode escolher/alterar a categoria, com as mesmas
permissões e privacidade dos demais campos do compromisso.

| Valor | Uso sugerido | Ícone sugerido |
| --- | --- | --- |
| `education` | Escola, aula | Chapéu de formatura |
| `health` | Consulta, exame | Coração |
| `meal` | Almoço, jantar | Talheres |
| `work` | Trabalho | Maleta |
| `sport` | Esporte | Haltere |
| `leisure` | Lazer | Balão/festa |
| `other` | Geral | Calendário |

Grave `category` no insert/update de `calendar_items`. O app mapeia esse valor
para a biblioteca de ícones que o JV escolher; o banco não precisa guardar nomes
específicos dessa biblioteca.

## Validação

`supabase/tests/database/family_home_visuals.test.sql` cobre contadores, autoria,
duplicidade, exclusão em cascata, categorias, caminhos das fotos, permissões
de upload/edição/remoção, isolamento entre famílias, convidados, anon e revogação.
`security.test.sql` também verifica RLS, grants e segurança de todas as novas tabelas/views.

Referências: [RLS e views com security_invoker](https://supabase.com/docs/guides/database/postgres/row-level-security)
e [permissões do Storage](https://supabase.com/docs/guides/storage/security/access-control).
