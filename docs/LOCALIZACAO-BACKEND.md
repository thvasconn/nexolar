# Localização: contrato para o mapa da família

Migration: `20261002000010_family_locations.sql`.

## Consultar o mapa

```ts
const { data: positions, error } = await supabase.rpc('family_locations', {
  p_family_id: familyId,
});
if (error) throw error;
```

O usuário precisa pertencer à família consultada. A resposta contém somente
pessoas que compartilham com **essa família** e já têm uma posição salva.
O próprio usuário também só aparece se compartilhar com essa família.
Quem não compartilha sua posição pode consultar o mapa e ver as posições autorizadas dos demais.

Ter acesso à posição de alguém por outra família não inclui essa pessoa neste
mapa. Família inexistente, `null` e família à qual o usuário não pertence retornam
uma lista vazia. Convidados externos de eventos não recebem acesso ao mapa.
`anon` não pode executar a RPC; ela usa `SECURITY INVOKER` e mantém o RLS das tabelas.

| Campo | Conteúdo |
| --- | --- |
| `member_id` | ID do membro na família consultada |
| `user_id` | ID do usuário que envia a posição |
| `display_name` | Nome escolhido na família, ou nome do perfil |
| `color` | Cor do membro, ou `null` |
| `avatar_path` | Caminho atual da foto no bucket privado `avatars`, ou `null` |
| `lat`, `lng` | Coordenadas da última posição |
| `accuracy_m` | Precisão informada pelo aparelho, em metros, ou `null` |
| `recorded_at` | Horário da posição GPS enviado pelo aparelho |
| `updated_at` | Horário de gravação no servidor |

`avatar_path` não é uma URL. Use `supabase.storage.from('avatars').createSignedUrl(path, 300)`
para exibir a bolinha; trate erros e renove a URL ao expirar. Sem foto, use um avatar
padrão ou iniciais. Pessoas sem login e pets não enviam GPS e ficam fora desta consulta.

Posições antigas continuam sendo retornadas enquanto houver compartilhamento.
Use `recorded_at` para exibir a idade da posição; o front define quando sinalizar
"posição desatualizada". A consulta retorna a última posição, sem histórico de rota.

## Ativar, enviar e desligar

O fluxo já existente continua válido, usando a sessão do próprio usuário:

```ts
// Ativar nesta família, após obter a permissão de localização do aparelho.
const { error: shareError } = await supabase.from('location_shares')
  .insert({ family_id: familyId });
if (shareError) throw shareError;

// Gravar a última posição. user_id vem da sessão, não é enviado pelo cliente.
const { error: positionError } = await supabase.from('member_locations').upsert({
  lat: latitude,
  lng: longitude,
  accuracy_m: accuracyMeters,
  recorded_at: recordedAtIso,
}, { onConflict: 'user_id' });
if (positionError) throw positionError;

// Desligar só nesta família. userId é o usuário da sessão atual.
const { error: stopError } = await supabase.from('location_shares').delete()
  .eq('family_id', familyId)
  .eq('user_id', userId);
if (stopError) throw stopError;
```

O banco exige pelo menos um compartilhamento ativo para **inserir ou atualizar**
a posição. Se o compartilhamento for desligado em todas as famílias, tanto
`UPDATE` quanto `UPSERT` são recusados com `42501`. A última posição fica salva,
legível pela própria pessoa, e não aparece no mapa das famílias.

Se a pessoa desligar em A e continuar compartilhando em B, o aparelho pode
continuar enviando posições para B; A não recebe essas posições na consulta.
Religar o compartilhamento permite atualizar o registro existente novamente.
Sair de uma família remove o compartilhamento dela automaticamente.

## Atualização da tela, sem avisos de desligamento

Desligar o compartilhamento **não gera notificação, push ou recado**.
Na próxima consulta, a posição simplesmente deixa de aparecer naquela família.
O mapa deve substituir sua lista de marcadores pelo resultado atual da RPC,
para retirar os que deixaram de ser retornados.

`member_locations` já está no Supabase Realtime. Ao receber uma nova posição,
refaça `family_locations` com a família atual; não aplique o payload bruto no mapa,
pois ele pode ser de alguém que compartilha com outra família em comum.
A assinatura para receber posições deve funcionar mesmo quando o observador
não compartilha sua própria posição.

Esta migration não adiciona eventos de desligamento ao Realtime. Para atualizar
marcadores de aparelhos que desligaram ou pararam de enviar posições, refaça a
consulta ao entrar/voltar à tela e periodicamente enquanto o mapa estiver visível.
Descarte respostas antigas quando trocar de família, para não repor marcadores do mapa anterior.

O mapa interativo, as fotos nos marcadores e a captura GPS em segundo plano ainda
precisam ser implementados no app. A tela atual usa uma lista e links para o Google Maps.

## Testes

`supabase/tests/database/family_locations.test.sql` verifica isolamento entre famílias
sobrepostas, campos para o mapa, consulta sem compartilhar a própria posição,
ausência de foto/GPS, desligamento sem notificação, bloqueio de gravação sem
consentimento, religamento, saída da família e bloqueio de estranhos/convidados/anon.

Referência: [funções de banco e permissões no Supabase](https://supabase.com/docs/guides/database/functions).
