import { router, useFocusEffect, type Href } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button, Chip, Chips, colors, Empty, Muted, Screen } from '@/components/ui';
import { useFamily } from '@/lib/family';
import { supabase } from '@/lib/supabase';

type Notification = {
  id: string; type: string; title: string; body: string | null; link: string | null; ref_id: string | null;
  priority: 'low' | 'normal' | 'high'; read_at: string | null; snoozed_until: string | null; done_at: string | null; created_at: string;
};
type Filter = 'open' | 'unread' | 'snoozed' | 'history';

const icon: Record<string, string> = {
  calendar_invite: '📅', event_invite: '🎉', task_assigned: '✅', notice: '📌', member_joined: '👋', bill_due: '💡', birthday: '🎂',
};
const priorityStyle = { high: { label: 'urgente', color: '#b91c1c' }, normal: { label: '', color: colors.text }, low: { label: '', color: colors.muted } };

// H07 Central de notificações.
export default function Notifications() {
  const { me } = useFamily();
  const [filter, setFilter] = useState<Filter>('open');
  const [items, setItems] = useState<Notification[]>([]);

  const load = useCallback(() => {
    supabase.from('notifications')
      .select('id, type, title, body, link, ref_id, priority, read_at, snoozed_until, done_at, created_at')
      .order('created_at', { ascending: false }).limit(100)
      .then(({ data }) => setItems((data ?? []) as Notification[]));
  }, []);
  useFocusEffect(load);

  const now = Date.now();
  const snoozed = (n: Notification) => !!n.snoozed_until && new Date(n.snoozed_until).getTime() > now;
  const shown = items.filter((n) => {
    if (filter === 'history') return !!n.done_at || !!n.read_at;
    if (n.done_at) return false;
    if (filter === 'snoozed') return snoozed(n);
    if (snoozed(n)) return false;
    return filter === 'unread' ? !n.read_at : true;
  }).sort((a, b) => (a.priority === 'high' ? -1 : 0) - (b.priority === 'high' ? -1 : 0));

  const patch = async (n: Notification, fields: Partial<Notification>) => {
    setItems((all) => all.map((x) => (x.id === n.id ? { ...x, ...fields } : x)));
    await supabase.from('notifications').update(fields).eq('id', n.id);
  };

  // Confirmar: em convite de compromisso, aceita; nos outros, conclui.
  async function confirm(n: Notification) {
    if (n.type === 'calendar_invite' && n.ref_id && me) {
      await supabase.from('calendar_participants').update({ status: 'accepted' }).eq('item_id', n.ref_id).eq('member_id', me.id);
    }
    patch(n, { done_at: new Date().toISOString(), read_at: n.read_at ?? new Date().toISOString() });
  }

  const snooze = (n: Notification) => {
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(8, 0, 0, 0);
    patch(n, { snoozed_until: tomorrow.toISOString() });
  };

  function openLink(n: Notification) {
    if (!n.read_at) patch(n, { read_at: new Date().toISOString() });
    if (n.link) router.push(n.link as Href);
  }

  return (
    <Screen>
      <Chips>
        {([['open', 'Abertas'], ['unread', 'Não lidas'], ['snoozed', 'Adiadas'], ['history', 'Histórico']] as const).map(([v, l]) => (
          <Chip key={v} label={l} selected={filter === v} onPress={() => setFilter(v)} />
        ))}
      </Chips>
      {shown.length === 0 && <Empty>Nada por aqui.</Empty>}
      {shown.map((n) => (
        <View key={n.id} style={[styles.item, !n.read_at && styles.unread]}>
          <Text style={[styles.title, { color: priorityStyle[n.priority].color }]} onPress={() => openLink(n)}>
            {icon[n.type] ?? '•'} {n.title}
          </Text>
          {n.body ? <Muted>{n.body}</Muted> : null}
          <Muted>
            {new Date(n.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
            {priorityStyle[n.priority].label ? ` · ${priorityStyle[n.priority].label}` : ''}
            {n.done_at ? ' · concluída' : snoozed(n) ? ` · adiada até ${new Date(n.snoozed_until!).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : ''}
          </Muted>
          {!n.done_at && (
            <View style={styles.actions}>
              <Button title={n.type === 'calendar_invite' ? 'Aceitar' : 'Confirmar'} variant="link" onPress={() => confirm(n)} />
              {!snoozed(n) && <Button title="Adiar p/ amanhã" variant="link" onPress={() => snooze(n)} />}
              {!n.read_at && <Button title="Marcar como lida" variant="link" onPress={() => patch(n, { read_at: new Date().toISOString() })} />}
            </View>
          )}
        </View>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  item: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12, gap: 2 },
  unread: { backgroundColor: '#eff6ff', borderColor: '#bfdbfe' },
  title: { fontSize: 16, fontWeight: '600' },
  actions: { flexDirection: 'row', flexWrap: 'wrap' },
});
