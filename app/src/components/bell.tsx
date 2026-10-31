import { router } from 'expo-router';
import { useEffect, useId, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { colors } from './ui';

// Sino do cabeçalho com o número de notificações não lidas (atualiza em tempo real).
export function Bell() {
  const { session } = useSession();
  const [unread, setUnread] = useState(0);
  // cada aba tem seu sino; nome de canal repetido faz o Supabase reaproveitar um canal já inscrito
  const instance = useId();

  useEffect(() => {
    const load = () => supabase.from('notifications').select('id', { count: 'exact', head: true })
      .is('read_at', null).is('done_at', null)
      .or(`snoozed_until.is.null,snoozed_until.lt.${new Date().toISOString()}`)
      .then(({ count }) => setUnread(count ?? 0));
    load();
    const channel = supabase.channel(`bell-${session?.user.id}-${instance}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, load).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [session, instance]);

  return (
    <Pressable onPress={() => router.push('/notificacoes')} accessibilityRole="button"
      accessibilityLabel={`Notificações, ${unread} não lidas`} style={{ paddingHorizontal: 16 }}>
      <Text style={{ fontSize: 22 }}>🔔</Text>
      {unread > 0 && (
        <View style={styles.badge}><Text style={styles.badgeText}>{unread > 9 ? '9+' : unread}</Text></View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  badge: { position: 'absolute', right: 8, top: -4, backgroundColor: colors.error, borderRadius: 9, minWidth: 18, height: 18, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
});
