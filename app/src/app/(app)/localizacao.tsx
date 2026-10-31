import * as Location from 'expo-location';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Linking } from 'react-native';
import { Button, Card, Chip, Chips, Empty, ErrorText, Muted, Screen, Section } from '@/components/ui';
import { memberName, useFamily } from '@/lib/family';
import { useSession } from '@/lib/session';
import { errorMessage, supabase } from '@/lib/supabase';

type Position = { user_id: string; lat: number; lng: number; recorded_at: string };

const ago = (iso: string) => {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  if (min < 1440) return `há ${Math.round(min / 60)} h`;
  return new Date(iso).toLocaleDateString('pt-BR');
};

async function sendPosition() {
  const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  await savePosition(pos);
}

const savePosition = (pos: Location.LocationObject) =>
  supabase.from('member_locations').upsert({
    lat: pos.coords.latitude, lng: pos.coords.longitude,
    accuracy_m: pos.coords.accuracy ?? null, recorded_at: new Date(pos.timestamp).toISOString(),
  }, { onConflict: 'user_id' });

// ponytail: só com o app aberto (foreground). Segundo plano exige development build + TaskManager.
export default function LocationScreen() {
  const { session } = useSession();
  const { family, members } = useFamily();
  const uid = session!.user.id;
  const [sharing, setSharing] = useState(false);
  const [positions, setPositions] = useState<Position[]>([]);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!family) return;
    const [share, locs] = await Promise.all([
      supabase.from('location_shares').select('user_id').eq('family_id', family.id).eq('user_id', uid).maybeSingle(),
      supabase.from('member_locations').select('user_id, lat, lng, recorded_at'),
    ]);
    setSharing(!!share.data);
    setPositions(locs.data ?? []);
  }, [family, uid]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Enquanto a tela está aberta e o compartilhamento ligado, atualiza a cada ~1 min / 100 m.
  useEffect(() => {
    if (!sharing) return;
    let sub: Location.LocationSubscription | null = null;
    Location.watchPositionAsync(
      { accuracy: Location.Accuracy.Balanced, timeInterval: 60000, distanceInterval: 100 },
      (pos) => { savePosition(pos).then(load); },
    ).then((s) => { sub = s; }).catch(() => {});
    // mudanças dos outros chegam em tempo real
    const channel = supabase.channel(`loc-${family?.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'member_locations' }, load).subscribe();
    return () => { sub?.remove(); supabase.removeChannel(channel); };
  }, [sharing, family, load]);

  async function turnOn() {
    setError('');
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return setError('Sem permissão de localização. Libere nas configurações do celular.');
    const { error } = await supabase.from('location_shares').insert({ family_id: family!.id });
    if (error) return setError(errorMessage(error));
    await sendPosition().catch((e) => setError(errorMessage(e)));
    load();
  }

  async function turnOff() {
    const { error } = await supabase.from('location_shares').delete().eq('family_id', family!.id).eq('user_id', uid);
    if (error) return setError(errorMessage(error));
    load();
  }

  const people = members.filter((m) => m.user_id);

  return (
    <Screen>
      <Section>Meu compartilhamento</Section>
      <Muted>Só você decide. Ao desligar, a família para de ver onde você está.</Muted>
      <Chips>
        <Chip label="📍 Compartilhar com a família" selected={sharing} onPress={sharing ? () => {} : turnOn} />
        <Chip label="Desligado" selected={!sharing} onPress={sharing ? turnOff : () => {}} />
      </Chips>
      {sharing && <Button title="Atualizar minha posição agora" variant="link" onPress={() => sendPosition().then(load)} />}
      <ErrorText>{error}</ErrorText>

      <Section>Família</Section>
      {people.length === 0 && <Empty>Ninguém com login na família ainda.</Empty>}
      {people.map((m) => {
        const pos = m.user_id === uid && !sharing ? undefined : positions.find((p) => p.user_id === m.user_id);
        return (
          <Card key={m.id} title={memberName(m) + (m.user_id === uid ? ' (você)' : '')}
            subtitle={pos ? `Atualizado ${ago(pos.recorded_at)}` : 'Não está compartilhando'}
            right={pos ? (
              <Button title="Mapa" variant="link"
                onPress={() => Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${pos.lat},${pos.lng}`)} />
            ) : undefined} />
        );
      })}
    </Screen>
  );
}
