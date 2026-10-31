import * as Linking from 'expo-linking';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Share, View } from 'react-native';
import { Button, Card, Chip, Chips, Empty, ErrorText, Field, Muted, Screen, Section } from '@/components/ui';
import { type Member, memberColor, memberName, useFamily } from '@/lib/family';
import { errorMessage, supabase } from '@/lib/supabase';

type Invite = { id: string; role: string; expires_at: string; created_at: string };
const roleLabel = { admin: 'Admin', adult: 'Adulto', child: 'Criança' };

// H03 Perfis da família: adultos, crianças, pets e convites.
export default function FamilyProfiles() {
  const { family, members, isAdmin, me, reload } = useFamily();
  const [invites, setInvites] = useState<Invite[]>([]);
  const [name, setName] = useState('');
  const [relation, setRelation] = useState('');
  const [kind, setKind] = useState<'adult' | 'child' | 'pet'>('child');
  const [error, setError] = useState('');

  const loadInvites = useCallback(() => {
    if (!family || !isAdmin) return;
    supabase.from('family_invites').select('id, role, expires_at, created_at')
      .eq('family_id', family.id).is('accepted_at', null).gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .then(({ data }) => setInvites(data ?? []));
  }, [family, isAdmin]);

  useFocusEffect(useCallback(() => { reload(); loadInvites(); }, [reload, loadInvites]));

  if (!family) return null;

  async function add() {
    if (!name.trim()) return setError('Informe o nome.');
    setError('');
    const { error } = await supabase.from('family_members').insert({
      family_id: family!.id, display_name: name.trim(), relationship: relation.trim() || null,
      kind: kind === 'pet' ? 'pet' : 'person', role: kind === 'child' ? 'child' : 'adult',
    });
    if (error) return setError(errorMessage(error));
    setName(''); setRelation('');
    reload();
  }

  async function invite(role: 'adult' | 'child') {
    setError('');
    const { data, error } = await supabase.rpc('create_family_invite', { p_family_id: family!.id, p_role: role });
    if (error) return setError(errorMessage(error));
    loadInvites();
    await Share.share({
      message: `Entre na família "${family!.name}" no app: ${Linking.createURL(`/convite/${data}`)}\n\nOu cole este código em "Usar convite": ${data}\n\nVale 7 dias e só pode ser usado uma vez.`,
    });
  }

  function revoke(i: Invite) {
    Alert.alert('Cancelar convite?', 'O link deixa de funcionar.', [
      { text: 'Não', style: 'cancel' },
      { text: 'Cancelar convite', style: 'destructive', onPress: async () => {
        await supabase.from('family_invites').delete().eq('id', i.id); loadInvites();
      } },
    ]);
  }

  const card = (m: Member) => (
    <Card key={m.id} title={`${m.kind === 'pet' ? '🐾' : '●'} ${memberName(m)}${m.id === me?.id ? ' (você)' : ''}`}
      subtitle={[m.relationship, m.kind === 'pet' ? null : m.user_id ? roleLabel[m.role] : 'sem login'].filter(Boolean).join(' · ')}
      right={<View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: memberColor(m, members) }} />}
      onPress={() => router.push({ pathname: '/membro/[id]', params: { id: m.id } })} />
  );

  const adults = members.filter((m) => m.kind === 'person' && m.role !== 'child');
  const children = members.filter((m) => m.kind === 'person' && m.role === 'child');
  const pets = members.filter((m) => m.kind === 'pet');

  return (
    <Screen>
      <Section>Adultos</Section>
      {adults.map(card)}
      <Section>Crianças</Section>
      {children.length ? children.map(card) : <Empty>Nenhuma criança.</Empty>}
      <Section>Pets</Section>
      {pets.length ? pets.map(card) : <Empty>Nenhum pet.</Empty>}

      {isAdmin && (
        <>
          <Section>Convites pendentes</Section>
          {invites.length === 0 && <Empty>Nenhum convite aberto.</Empty>}
          {invites.map((i) => (
            <Card key={i.id} title={`Convite (${roleLabel[i.role as keyof typeof roleLabel]})`}
              subtitle={`vale até ${new Date(i.expires_at).toLocaleDateString('pt-BR')}`}
              right={<Button title="Cancelar" variant="link" onPress={() => revoke(i)} />} />
          ))}
          <Chips>
            <Chip label="+ Convidar adulto" onPress={() => invite('adult')} />
            <Chip label="+ Convidar jovem" onPress={() => invite('child')} />
          </Chips>
          <Muted>Convidar pessoas com login é recurso premium.</Muted>

          <Section>Adicionar sem login</Section>
          <Chips>
            <Chip label="Criança" selected={kind === 'child'} onPress={() => setKind('child')} />
            <Chip label="Adulto" selected={kind === 'adult'} onPress={() => setKind('adult')} />
            <Chip label="🐾 Pet" selected={kind === 'pet'} onPress={() => setKind('pet')} />
          </Chips>
          <Field label="Nome" value={name} onChangeText={setName} maxLength={60} />
          <Field label={kind === 'pet' ? 'Espécie (opcional)' : 'Parentesco (opcional)'} value={relation} onChangeText={setRelation}
            placeholder={kind === 'pet' ? 'Ex.: cachorro' : 'Ex.: filho, avó'} maxLength={40} />
          <Button title="Adicionar" onPress={add} />
        </>
      )}
      <ErrorText>{error}</ErrorText>
    </Screen>
  );
}
