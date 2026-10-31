import * as Linking from 'expo-linking';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Share } from 'react-native';
import { Button, Card, Chip, Chips, Empty, ErrorText, Field, Muted, Screen, Section, Title } from '@/components/ui';
import { eventTypeLabel, rsvpLabel } from '@/lib/events';
import { memberName, useFamily } from '@/lib/family';
import { fmtDateTime, fmtMoney, parseMoney } from '@/lib/format';
import { useSession } from '@/lib/session';
import { errorMessage, supabase } from '@/lib/supabase';

type Event = {
  id: string; family_id: string; created_by: string | null; type: string; title: string;
  description: string | null; starts_at: string; location_text: string | null;
};
type Participant = { id: string; member_id: string | null; user_id: string | null; display_name: string; rsvp: string };
type Dish = { id: string; name: string; assigned_to: string | null };
type Expense = { id: string; description: string; amount_cents: number; paid_by: string; created_by: string | null };
type Balance = { participant_id: string; balance_cents: number };

export default function EventScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useSession();
  const uid = session?.user.id;
  const { families, members, isAdmin } = useFamily();
  const [event, setEvent] = useState<Event | null>(null);
  const [people, setPeople] = useState<Participant[]>([]);
  const [dishes, setDishes] = useState<Dish[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [santa, setSanta] = useState<string | null>(null);
  const [guest, setGuest] = useState('');
  const [dish, setDish] = useState('');
  const [desc, setDesc] = useState('');
  const [amount, setAmount] = useState('');
  const [payer, setPayer] = useState<string | null>(null);
  const [split, setSplit] = useState<string[]>([]);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const [e, p, d, x, b, s] = await Promise.all([
      supabase.from('events').select('id, family_id, created_by, type, title, description, starts_at, location_text').eq('id', id).single(),
      supabase.from('event_participants').select('id, member_id, user_id, display_name, rsvp').eq('event_id', id).order('created_at'),
      supabase.from('event_dishes').select('id, name, assigned_to').eq('event_id', id).order('created_at'),
      supabase.from('expenses').select('id, description, amount_cents, paid_by, created_by').eq('event_id', id).order('created_at'),
      supabase.rpc('event_balances', { p_event_id: id }),
      supabase.from('secret_santa_pairs').select('receiver_id').eq('event_id', id).maybeSingle(),
    ]);
    if (e.error) return setError(errorMessage(e.error));
    setEvent(e.data);
    setPeople(p.data ?? []);
    setDishes(d.data ?? []);
    setExpenses(x.data ?? []);
    setBalances((b.data ?? []) as Balance[]);
    setSanta(s.data?.receiver_id ?? null);
    setSplit((cur) => (cur.length ? cur : (p.data ?? []).map((pp) => pp.id)));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (!event) return <Screen><ErrorText>{error}</ErrorText></Screen>;

  const canEdit = families.some((f) => f.id === event.family_id);
  const mine = people.find((p) => p.user_id === uid);
  const nameOf = (pid: string | null) => people.find((p) => p.id === pid)?.display_name ?? '?';
  const run = async (fn: () => PromiseLike<{ error: unknown }>) => {
    setError('');
    const { error } = await fn();
    if (error) setError(errorMessage(error));
    load();
  };

  async function inviteGuest() {
    if (!guest.trim()) return setError('Informe o nome do convidado.');
    setError('');
    const { data, error } = await supabase.from('event_participants')
      .insert({ event_id: id, display_name: guest.trim() }).select('id').single();
    if (error) return setError(errorMessage(error));
    const { data: token, error: tErr } = await supabase.rpc('create_event_invite', { p_participant_id: data.id });
    if (tErr) return setError(errorMessage(tErr));
    setGuest('');
    load();
    await Share.share({
      message: `Você foi convidado para "${event!.title}" (${fmtDateTime(event!.starts_at)}). Toque no link: ${Linking.createURL(`/evento-convite/${token}`)}\n\nOu use o código: ${token}`,
    });
  }

  const missingMembers = canEdit ? members.filter((m) => !people.some((p) => p.member_id === m.id)) : [];

  async function addExpense() {
    const cents = parseMoney(amount);
    if (!desc.trim()) return setError('Descreva o gasto.');
    if (cents === null || cents <= 0) return setError('Valor inválido. Ex.: 150,00');
    if (!payer) return setError('Quem pagou?');
    if (split.length === 0) return setError('Escolha quem divide.');
    await run(() => supabase.rpc('add_expense', {
      p_event_id: id, p_description: desc.trim(), p_amount_cents: cents, p_paid_by: payer, p_party_ids: split,
    }));
    setDesc(''); setAmount('');
  }

  function removeEvent() {
    Alert.alert('Apagar evento?', 'Pratos, convidados e gastos também serão apagados.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Apagar', style: 'destructive', onPress: async () => {
        const { error } = await supabase.from('events').delete().eq('id', id);
        if (error) return setError(errorMessage(error));
        router.back();
      } },
    ]);
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: event.title }} />
      <Title>{event.title}</Title>
      <Muted>{eventTypeLabel(event.type)} · {fmtDateTime(event.starts_at)}{event.location_text ? ` · ${event.location_text}` : ''}</Muted>
      {event.description ? <Muted>{event.description}</Muted> : null}

      {mine && (
        <>
          <Section>Você vai?</Section>
          <Chips>
            {(['yes', 'maybe', 'no'] as const).map((r) => (
              <Chip key={r} label={rsvpLabel[r]} selected={mine.rsvp === r}
                onPress={() => run(() => supabase.from('event_participants').update({ rsvp: r }).eq('id', mine.id))} />
            ))}
          </Chips>
        </>
      )}

      <Section>Participantes ({people.length})</Section>
      {people.map((p) => <Card key={p.id} title={p.display_name} subtitle={`${rsvpLabel[p.rsvp]}${!p.member_id ? ' · convidado' : ''}`} />)}
      {missingMembers.length > 0 && (
        <Chips>
          {missingMembers.map((m) => (
            <Chip key={m.id} label={`+ ${memberName(m)}`}
              onPress={() => run(() => supabase.from('event_participants').insert({ event_id: id, member_id: m.id, display_name: 'x' }))} />
          ))}
        </Chips>
      )}
      {canEdit && (
        <>
          <Field label="Convidar alguém de fora da família" value={guest} onChangeText={setGuest} placeholder="Nome" maxLength={60} />
          <Muted>A pessoa vê só este evento. Ela recebe um link para entrar pelo app.</Muted>
          <Button title="Gerar convite" variant="link" onPress={inviteGuest} />
        </>
      )}

      <Section>Pratos e itens</Section>
      {dishes.length === 0 && <Empty>Ninguém definiu o cardápio ainda.</Empty>}
      {dishes.map((d) => (
        <Card key={d.id} title={d.name} subtitle={d.assigned_to ? `leva: ${nameOf(d.assigned_to)}` : 'ninguém assumiu'}
          right={mine && (!d.assigned_to || d.assigned_to === mine.id) ? (
            <Button title={d.assigned_to ? 'Largar' : 'Eu levo'} variant="link"
              onPress={() => run(() => supabase.rpc('claim_dish', { p_dish_id: d.id, p_claim: !d.assigned_to }))} />
          ) : undefined} />
      ))}
      {canEdit && (
        <>
          <Field label="Novo prato/item" value={dish} onChangeText={setDish} placeholder="Ex.: Bacalhau, farofa, refrigerante" maxLength={120} />
          <Button title="Adicionar" variant="link" onPress={async () => {
            if (!dish.trim()) return;
            await run(() => supabase.from('event_dishes').insert({ event_id: id, name: dish.trim() }));
            setDish('');
          }} />
        </>
      )}

      {event.type === 'secret_santa' && (
        <>
          <Section>🎁 Amigo oculto</Section>
          {santa ? <Card title={`Você tirou: ${nameOf(santa)}`} subtitle="Só você vê isso." /> : <Empty>Ainda não sorteado.</Empty>}
          {canEdit && (
            <Button title={santa ? 'Sortear de novo' : 'Sortear'} variant="link"
              onPress={() => run(() => supabase.rpc('draw_secret_santa', { p_event_id: id }))} />
          )}
          <Muted>Quem não vai (resposta "não vai") fica fora do sorteio. Quem organiza também não vê os pares.</Muted>
        </>
      )}

      <Section>Rateio</Section>
      {expenses.length === 0 && <Empty>Nenhum gasto lançado.</Empty>}
      {expenses.map((x) => (
        <Card key={x.id} title={`${x.description} · ${fmtMoney(x.amount_cents)}`} subtitle={`pago por ${nameOf(x.paid_by)}`}
          right={x.created_by === uid || isAdmin ? (
            <Button title="✕" variant="link" onPress={() => run(() => supabase.from('expenses').delete().eq('id', x.id))} />
          ) : undefined} />
      ))}
      {balances.filter((b) => b.balance_cents !== 0).map((b) => (
        <Muted key={b.participant_id}>
          {nameOf(b.participant_id)} {b.balance_cents > 0 ? 'recebe' : 'deve'} {fmtMoney(Math.abs(b.balance_cents))}
        </Muted>
      ))}
      {mine || canEdit ? (
        <>
          <Field label="Gasto" value={desc} onChangeText={setDesc} placeholder="Ex.: Bacalhau" maxLength={120} />
          <Field label="Valor" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0,00" />
          <Muted>Quem pagou</Muted>
          <Chips>{people.map((p) => <Chip key={p.id} label={p.display_name} selected={payer === p.id} onPress={() => setPayer(p.id)} />)}</Chips>
          <Muted>Divide igualmente entre</Muted>
          <Chips>
            {people.map((p) => (
              <Chip key={p.id} label={p.display_name} selected={split.includes(p.id)}
                onPress={() => setSplit((s) => (s.includes(p.id) ? s.filter((x) => x !== p.id) : [...s, p.id]))} />
            ))}
          </Chips>
          <Button title="Lançar gasto" onPress={addExpense} />
        </>
      ) : null}

      <ErrorText>{error}</ErrorText>
      {(event.created_by === uid || isAdmin) && canEdit && <Button title="Apagar evento" variant="link" onPress={removeEvent} />}
    </Screen>
  );
}
