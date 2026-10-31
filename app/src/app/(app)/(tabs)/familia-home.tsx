import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import { Button, Card, Chip, Chips, Empty, ErrorText, Field, Muted, Screen, Section, Title } from '@/components/ui';
import { type Bill, type BillPayment, currentPeriod, dueLabel, dueThisMonth, isPaid } from '@/lib/bills';
import { memberBirth, memberName, useFamily } from '@/lib/family';
import { fmtDateTime, fmtMoney, listTotal, upcomingBirthdays } from '@/lib/format';
import { useSession } from '@/lib/session';
import { errorMessage, supabase } from '@/lib/supabase';

type Notice = { id: string; body: string; pinned: boolean; author_id: string; created_at: string; profiles: { full_name: string } | null };
type Event = { id: string; title: string; starts_at: string };
type List = { id: string; name: string; shopping_items: { price_cents: number | null; quantity: number; checked: boolean }[] };

// H02 Home da família: o que é compartilhado.
export default function FamilyHome() {
  const { session } = useSession();
  const { family, members, isAdmin } = useFamily();
  const [notices, setNotices] = useState<Notice[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [list, setList] = useState<List | null>(null);
  const [bills, setBills] = useState<Bill[]>([]);
  const [payments, setPayments] = useState<BillPayment[]>([]);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(() => {
    if (!family) return;
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const week = new Date(start); week.setDate(week.getDate() + 7);
    supabase.from('family_notices').select('id, body, pinned, author_id, created_at, profiles(full_name)')
      .eq('family_id', family.id).order('pinned', { ascending: false }).order('created_at', { ascending: false }).limit(10)
      .then(({ data }) => setNotices((data ?? []) as unknown as Notice[]));
    supabase.from('events').select('id, title, starts_at').eq('family_id', family.id)
      .gte('starts_at', start.toISOString()).lt('starts_at', week.toISOString()).order('starts_at')
      .then(({ data }) => setEvents(data ?? []));
    supabase.from('shopping_lists').select('id, name, shopping_items(price_cents, quantity, checked)')
      .eq('family_id', family.id).eq('status', 'open').order('created_at', { ascending: false }).limit(1).maybeSingle()
      .then(({ data }) => setList(data as List | null));
    supabase.from('bills').select('id, name, category, amount_cents, due_day, responsible_id, active')
      .eq('family_id', family.id).eq('active', true)
      .then(({ data }) => setBills(data ?? []));
    supabase.from('bill_payments').select('bill_id, period').eq('period', currentPeriod())
      .then(({ data }) => setPayments(data ?? []));
  }, [family]);

  useFocusEffect(load);

  if (!family) return null;

  async function post() {
    if (!note.trim()) return;
    setError('');
    const { error } = await supabase.from('family_notices').insert({ family_id: family!.id, body: note.trim() });
    if (error) return setError(errorMessage(error));
    setNote('');
    load();
  }

  function noticeActions(n: Notice) {
    const canManage = n.author_id === session?.user.id || isAdmin;
    if (!canManage) return;
    Alert.alert('Recado', n.body, [
      { text: 'Cancelar', style: 'cancel' },
      { text: n.pinned ? 'Desafixar' : '📌 Fixar', onPress: async () => {
        await supabase.from('family_notices').update({ pinned: !n.pinned }).eq('id', n.id); load();
      } },
      { text: 'Apagar', style: 'destructive', onPress: async () => {
        await supabase.from('family_notices').delete().eq('id', n.id); load();
      } },
    ]);
  }

  async function pay(b: Bill) {
    const { error } = await supabase.from('bill_payments').insert({ bill_id: b.id, period: currentPeriod(), amount_cents: b.amount_cents });
    if (error) return setError(errorMessage(error));
    load();
  }

  const soon = new Date(); soon.setDate(soon.getDate() + 7);
  const dueSoon = bills.filter((b) => !isPaid(b, payments) && dueThisMonth(b) <= soon)
    .sort((a, b) => dueThisMonth(a).getTime() - dueThisMonth(b).getTime());
  const birthdays = upcomingBirthdays(members.map((m) => ({ ...m, birth_date: memberBirth(m) })));

  return (
    <Screen>
      <Title>{family.name}</Title>

      <Section>Mural</Section>
      <Field label="Deixe um recado para a família" value={note} onChangeText={setNote} placeholder="Ex.: chego tarde hoje" maxLength={500} />
      <Button title="Publicar" variant="link" onPress={post} />
      {notices.length === 0 && <Empty>Nenhum recado.</Empty>}
      {notices.map((n) => (
        <Card key={n.id} title={`${n.pinned ? '📌 ' : ''}${n.body}`}
          subtitle={`${n.profiles?.full_name ?? 'Alguém'} · ${new Date(n.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`}
          onPress={() => noticeActions(n)} />
      ))}

      <Section>Eventos da semana</Section>
      {events.length === 0 && <Empty>Nenhum evento nos próximos 7 dias.</Empty>}
      {events.map((e) => (
        <Card key={e.id} title={e.title} subtitle={fmtDateTime(e.starts_at)}
          onPress={() => router.push({ pathname: '/evento/[id]', params: { id: e.id } })} />
      ))}

      <Section>Compras</Section>
      {list ? (
        <Card title={list.name}
          subtitle={`${list.shopping_items.filter((i) => i.checked).length}/${list.shopping_items.length} no carrinho · ${fmtMoney(listTotal(list.shopping_items))}`}
          onPress={() => router.push({ pathname: '/lista/[id]', params: { id: list.id } })} />
      ) : <Empty>Nenhuma lista aberta.</Empty>}

      <Section>Contas a pagar</Section>
      {dueSoon.length === 0 && <Empty>Nada vencendo nos próximos 7 dias.</Empty>}
      {dueSoon.map((b) => (
        <Card key={b.id} title={`${b.name}${b.amount_cents ? ` · ${fmtMoney(b.amount_cents)}` : ''}`}
          subtitle={`${dueLabel(b)}${b.responsible_id ? ` · ${memberName(members.find((m) => m.id === b.responsible_id)!)}` : ''}`}
          right={<Button title="Paguei" variant="link" onPress={() => pay(b)} />} />
      ))}

      <Section>Aniversários</Section>
      {birthdays.length === 0 && <Empty>Nenhum nos próximos 30 dias.</Empty>}
      {birthdays.map((b) => (
        <Card key={b.person.id} title={`🎂 ${memberName(b.person)}`}
          subtitle={b.inDays === 0 ? 'Hoje!' : `${b.date.toLocaleDateString('pt-BR')} · em ${b.inDays} dia(s)`} />
      ))}
      <ErrorText>{error}</ErrorText>

      <Section>Módulos</Section>
      <Chips>
        <Chip label="👪 Perfis" onPress={() => router.push('/familia')} />
        <Chip label="📍 Localização" onPress={() => router.push('/localizacao')} />
        <Chip label="✅ Tarefas" onPress={() => router.push('/tarefas')} />
        <Chip label="🍽️ Cardápio" onPress={() => router.push('/cardapio')} />
        <Chip label="💡 Contas" onPress={() => router.push('/contas')} />
        <Chip label="🎉 Eventos" onPress={() => router.push('/eventos')} />
      </Chips>
      <Muted>Toque em um recado seu para fixar ou apagar.</Muted>
    </Screen>
  );
}
