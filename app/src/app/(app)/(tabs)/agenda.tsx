import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Button, Card, Chip, Chips, colors, Empty, Muted, Screen, Section } from '@/components/ui';
import { memberBirth, memberColor, memberName, useFamily } from '@/lib/family';
import { fmtDay, fmtPeriod, upcomingBirthdays } from '@/lib/format';
import { useSession } from '@/lib/session';
import { errorMessage, supabase } from '@/lib/supabase';

type Participant = { member_id: string; status: 'pending' | 'accepted' | 'declined' };
type Item = {
  id: string; title: string; starts_at: string; ends_at: string | null; all_day: boolean; family_id: string | null;
  visibility: 'private' | 'family'; owner_id: string; location_text: string | null; recurrence: string | null;
  calendar_participants: Participant[];
};
type Period = 'day' | 'week' | 'month';

const recurrenceLabel: Record<string, string> = { daily: 'todo dia', weekly: 'toda semana', monthly: 'todo mês', yearly: 'todo ano' };

function range(period: Period, anchor: Date) {
  const start = new Date(anchor); start.setHours(0, 0, 0, 0);
  if (period === 'week') start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  if (period === 'month') start.setDate(1);
  const end = new Date(start);
  if (period === 'day') end.setDate(end.getDate() + 1);
  if (period === 'week') end.setDate(end.getDate() + 7);
  if (period === 'month') end.setMonth(end.getMonth() + 1);
  return { start, end };
}

function rangeLabel(period: Period, start: Date, end: Date) {
  if (period === 'day') return start.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  if (period === 'month') return start.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  const last = new Date(end); last.setDate(last.getDate() - 1);
  return `${start.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} a ${last.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}`;
}

// sem término, conta 1 hora para detectar conflito
const endOf = (i: Item) => (i.ends_at ? new Date(i.ends_at) : new Date(new Date(i.starts_at).getTime() + 60 * 60000));

// H05 Agenda pessoal + H06 Agenda familiar.
export default function Agenda() {
  const { session } = useSession();
  const uid = session!.user.id;
  const { family, members, me, isAdmin } = useFamily();
  const [scope, setScope] = useState<'mine' | 'family'>('mine');
  const [period, setPeriod] = useState<Period>('week');
  const [anchor, setAnchor] = useState(new Date());
  const [items, setItems] = useState<Item[]>([]);
  const [pending, setPending] = useState<Item[]>([]);

  const { start, end } = range(period, anchor);

  const load = useCallback(() => {
    if (!family) return;
    const { start, end } = range(period, anchor);
    const cols = 'id, title, starts_at, ends_at, all_day, family_id, visibility, owner_id, location_text, recurrence, calendar_participants(member_id, status)';
    supabase.from('calendar_items').select(cols)
      .or(`family_id.eq.${family.id},family_id.is.null`)
      .gte('starts_at', start.toISOString()).lt('starts_at', end.toISOString()).order('starts_at')
      .then(({ data }) => setItems((data ?? []) as Item[]));
    // convites pendentes de qualquer data futura
    supabase.from('calendar_items').select(cols).gte('starts_at', new Date().toISOString()).order('starts_at')
      .then(({ data }) => setPending(((data ?? []) as Item[]).filter((i) =>
        i.calendar_participants.some((p) => p.member_id === me?.id && p.status === 'pending'))));
  }, [family, period, anchor, me]);

  useFocusEffect(load);

  if (!family) return null;

  const ownerMember = (i: Item) => members.find((m) => m.user_id === i.owner_id);
  const people = (i: Item) => [ownerMember(i)?.id, ...i.calendar_participants.filter((p) => p.status !== 'declined').map((p) => p.member_id)]
    .filter(Boolean) as string[];
  const involvesMe = (i: Item) => i.owner_id === uid || i.calendar_participants.some((p) => p.member_id === me?.id && p.status !== 'declined');

  const shown = items.filter((i) => (scope === 'mine' ? involvesMe(i) : i.visibility === 'family' && i.family_id === family.id));

  // conflito: mesma pessoa em dois compromissos com horários sobrepostos
  const conflictWith = (i: Item) => {
    if (i.all_day) return null;
    const other = shown.find((o) => o.id !== i.id && !o.all_day
      && new Date(o.starts_at) < endOf(i) && new Date(i.starts_at) < endOf(o)
      && people(o).some((p) => people(i).includes(p)));
    if (!other) return null;
    const who = members.find((m) => m.id === people(other).find((p) => people(i).includes(p)));
    return `${who ? memberName(who) : 'alguém'} tem "${other.title}" no mesmo horário`;
  };

  const birthdays = scope === 'family'
    ? upcomingBirthdays(members.map((m) => ({ ...m, birth_date: memberBirth(m) })), 366).filter((b) => b.date >= start && b.date < end)
    : [];

  async function respond(i: Item, status: 'accepted' | 'declined') {
    const { error } = await supabase.from('calendar_participants').update({ status }).eq('item_id', i.id).eq('member_id', me!.id);
    if (error) Alert.alert(errorMessage(error));
    load();
  }

  function open(i: Item) {
    if (i.owner_id === uid) return router.push({ pathname: '/compromisso/novo', params: { id: i.id } });
    const mine = i.calendar_participants.find((p) => p.member_id === me?.id);
    const actions: { text: string; style?: 'cancel' | 'destructive'; onPress?: () => void }[] = [{ text: 'Fechar', style: 'cancel' }];
    if (mine && mine.status !== 'accepted') actions.push({ text: 'Aceitar', onPress: () => respond(i, 'accepted') });
    if (mine && mine.status !== 'declined') actions.push({ text: 'Recusar', onPress: () => respond(i, 'declined') });
    if (isAdmin && i.visibility === 'family') actions.push({ text: 'Apagar', style: 'destructive', onPress: async () => {
      const { error } = await supabase.from('calendar_items').delete().eq('id', i.id);
      if (error) Alert.alert(errorMessage(error));
      load();
    } });
    const owner = ownerMember(i);
    Alert.alert(i.title, `${fmtDay(i.starts_at)} · ${i.all_day ? 'dia todo' : fmtPeriod(i.starts_at, i.ends_at)}\nCriado por ${owner ? memberName(owner) : 'alguém'}`, actions);
  }

  const move = (dir: 1 | -1) => {
    const a = new Date(anchor);
    if (period === 'day') a.setDate(a.getDate() + dir);
    if (period === 'week') a.setDate(a.getDate() + 7 * dir);
    if (period === 'month') a.setMonth(a.getMonth() + dir);
    setAnchor(a);
  };

  type Row = { key: string; day: string; item?: Item; bday?: string };
  const rows: Row[] = [
    ...shown.map((i) => ({ key: i.id, day: new Date(i.starts_at).toDateString(), item: i })),
    ...birthdays.map((b) => ({ key: `b-${b.person.id}`, day: b.date.toDateString(), bday: memberName(b.person) })),
  ].sort((a, b) => new Date(a.day).getTime() - new Date(b.day).getTime());

  let lastDay = '';
  return (
    <Screen>
      <Chips>
        <Chip label="🙂 Minha" selected={scope === 'mine'} onPress={() => setScope('mine')} />
        <Chip label="👪 Da família" selected={scope === 'family'} onPress={() => setScope('family')} />
      </Chips>
      <Chips>
        {(['day', 'week', 'month'] as const).map((p) => (
          <Chip key={p} label={{ day: 'Dia', week: 'Semana', month: 'Mês' }[p]} selected={period === p} onPress={() => setPeriod(p)} />
        ))}
      </Chips>
      <View style={styles.nav}>
        <Pressable onPress={() => move(-1)} accessibilityLabel="Anterior" style={styles.arrow}><Text style={styles.arrowText}>‹</Text></Pressable>
        <Pressable onPress={() => setAnchor(new Date())} accessibilityLabel="Voltar para hoje" style={{ flex: 1 }}>
          <Text style={styles.navLabel}>{rangeLabel(period, start, end)}</Text>
        </Pressable>
        <Pressable onPress={() => move(1)} accessibilityLabel="Próximo" style={styles.arrow}><Text style={styles.arrowText}>›</Text></Pressable>
      </View>
      <Button title="+ Novo compromisso" onPress={() => router.push('/compromisso/novo')} />

      {pending.length > 0 && (
        <>
          <Section>Convites para você</Section>
          {pending.map((i) => {
            const owner = ownerMember(i);
            return (
              <Card key={i.id} title={i.title}
                subtitle={`${fmtDay(i.starts_at)} · ${i.all_day ? 'dia todo' : fmtPeriod(i.starts_at, i.ends_at)} · de ${owner ? memberName(owner) : 'alguém'}`}
                right={<View style={{ flexDirection: 'row' }}>
                  <Button title="Aceitar" variant="link" onPress={() => respond(i, 'accepted')} />
                  <Button title="Recusar" variant="link" onPress={() => respond(i, 'declined')} />
                </View>} />
            );
          })}
        </>
      )}

      {rows.length === 0 && <Empty>Nada neste período.</Empty>}
      {rows.map((r) => {
        const header = r.day !== lastDay && period !== 'day' ? <Section>{fmtDay(new Date(r.day).toISOString())}</Section> : null;
        lastDay = r.day;
        if (!r.item) return <View key={r.key}>{header}<Card title={`🎂 Aniversário de ${r.bday}`} subtitle="Dia todo" /></View>;
        const i = r.item;
        const conflict = conflictWith(i);
        const myStatus = i.calendar_participants.find((p) => p.member_id === me?.id)?.status;
        const withWho = i.calendar_participants.map((p) => members.find((m) => m.id === p.member_id))
          .filter(Boolean).map((m) => memberName(m!)).join(', ');
        return (
          <View key={r.key}>
            {header}
            <Pressable onPress={() => open(i)} accessibilityRole="button"
              style={[styles.item, { borderLeftColor: memberColor(ownerMember(i), members) }]}>
              <Text style={styles.itemTitle}>{i.visibility === 'private' ? '🔒 ' : ''}{i.title}</Text>
              <Muted>
                {[i.all_day ? 'Dia todo' : fmtPeriod(i.starts_at, i.ends_at), i.location_text,
                  i.recurrence && recurrenceLabel[i.recurrence], withWho && `com ${withWho}`,
                  myStatus === 'pending' ? 'aguardando sua resposta' : myStatus === 'declined' ? 'você recusou' : null]
                  .filter(Boolean).join(' · ')}
              </Muted>
              {conflict && <Text style={styles.conflict}>⚠️ Conflito: {conflict}</Text>}
            </Pressable>
          </View>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  nav: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  arrow: { padding: 8 },
  arrowText: { fontSize: 28, color: colors.primary },
  navLabel: { textAlign: 'center', fontSize: 16, fontWeight: '600', color: colors.text, textTransform: 'capitalize' },
  item: { borderWidth: 1, borderColor: colors.border, borderLeftWidth: 6, borderRadius: 10, padding: 12, marginTop: 6, gap: 2 },
  itemTitle: { fontSize: 16, fontWeight: '600', color: colors.text },
  conflict: { color: '#b45309', fontWeight: '600', marginTop: 2 },
});
