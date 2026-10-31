import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { Button, Card, Chip, Chips, Empty, ErrorText, Field, Muted, Screen, Section, Title } from '@/components/ui';
import { colorPalette, memberBirth, memberColor, memberName, useFamily } from '@/lib/family';
import { type Goal, type GoalLog, logsSince, periodLabel, progress } from '@/lib/goals';
import { errorMessage, supabase } from '@/lib/supabase';

const roleLabel = { admin: 'Admin', adult: 'Adulto', child: 'Criança' } as const;
const roleHelp = {
  admin: 'Gerencia membros, convites e permissões. Não vê o que é privado dos outros.',
  adult: 'Usa todos os módulos da família.',
  child: 'Perfil de criança/jovem, administrado pelos responsáveis.',
};

function age(birth: string | null) {
  if (!birth) return null;
  const [y, m, d] = birth.split('-').map(Number);
  const now = new Date();
  return now.getFullYear() - y - (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d) ? 1 : 0);
}

// H04 Perfil individual: dados básicos, metas, acessos e privacidade.
export default function MemberProfile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { family, members, me, isAdmin, reload } = useFamily();
  const member = members.find((m) => m.id === id);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [logs, setLogs] = useState<GoalLog[]>([]);
  const [sharing, setSharing] = useState(false);
  const [relation, setRelation] = useState(member?.relationship ?? '');
  const [error, setError] = useState('');

  useFocusEffect(useCallback(() => {
    if (!member?.user_id || !family) return;
    supabase.from('goals').select('id, owner_id, title, target, unit, period, visibility')
      .eq('owner_id', member.user_id).eq('archived', false).then(({ data }) => setGoals((data ?? []) as Goal[]));
    supabase.from('goal_logs').select('goal_id, logged_on, amount').gte('logged_on', logsSince())
      .then(({ data }) => setLogs(data ?? []));
    supabase.from('location_shares').select('user_id').eq('family_id', family.id).eq('user_id', member.user_id).maybeSingle()
      .then(({ data }) => setSharing(!!data));
  }, [member?.user_id, family]));

  if (!member || !family) return <Screen><Empty>Pessoa não encontrada nesta família.</Empty></Screen>;

  const isMe = member.id === me?.id;
  const isOwner = member.user_id === family.owner_id;
  const birth = memberBirth(member);
  const years = age(birth);

  const update = async (patch: Record<string, unknown>) => {
    setError('');
    const { error } = await supabase.from('family_members').update(patch).eq('id', member.id);
    if (error) setError(errorMessage(error));
    reload();
  };

  function remove() {
    Alert.alert(isMe ? 'Sair da família?' : `Remover ${memberName(member!)}?`,
      isMe ? 'Você deixa de ver agenda, listas e eventos desta família.' : 'A pessoa perde o acesso à família.', [
        { text: 'Cancelar', style: 'cancel' },
        { text: isMe ? 'Sair' : 'Remover', style: 'destructive', onPress: async () => {
          const { error } = await supabase.from('family_members').delete().eq('id', member!.id);
          if (error) return setError(errorMessage(error));
          reload();
          router.dismissTo('/');
        } },
      ]);
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: memberName(member) }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: memberColor(member, members) }} />
        <Title>{member.kind === 'pet' ? '🐾 ' : ''}{memberName(member)}</Title>
      </View>

      <Section>Visão geral</Section>
      <Card title="Parentesco" subtitle={member.relationship ?? 'não informado'} />
      <Card title="Aniversário" subtitle={birth ? `${birth.split('-').reverse().join('/')}${years != null ? ` · ${years} anos` : ''}` : 'não informado'} />
      {member.kind === 'person' && <Card title="Acesso ao app" subtitle={member.user_id ? `com login · ${roleLabel[member.role]}` : 'sem login (perfil gerenciado)'} />}
      {isMe && <Button title="Editar meu perfil (nome, foto, aniversário)" onPress={() => router.push('/perfil')} />}

      {member.user_id && (
        <>
          <Section>Metas</Section>
          {goals.length === 0 && <Empty>{isMe ? 'Você ainda não tem metas.' : 'Nenhuma meta compartilhada.'}</Empty>}
          {goals.map((g) => (
            <Card key={g.id} title={`${g.visibility === 'private' ? '🔒 ' : ''}${g.title}`}
              subtitle={`${progress(g, logs).toLocaleString('pt-BR')} / ${Number(g.target).toLocaleString('pt-BR')} ${g.unit} ${periodLabel(g.period)}`} />
          ))}
          {isMe && <Button title="Gerenciar minhas metas" variant="link" onPress={() => router.push('/metas')} />}

          <Section>Privacidade</Section>
          <Card title="Localização" subtitle={sharing ? '📍 compartilhando com a família' : 'não compartilha'}
            onPress={isMe ? () => router.push('/localizacao') : undefined} />
          <Muted>Metas privadas e compromissos privados desta pessoa não aparecem para ninguém, nem para o admin.</Muted>
        </>
      )}

      {isAdmin && (
        <>
          <Section>Acessos (admin)</Section>
          {member.kind === 'person' && !isOwner && (
            <>
              <Chips>
                {(['admin', 'adult', 'child'] as const)
                  .filter((r) => r !== 'admin' || member.user_id)
                  .map((r) => <Chip key={r} label={roleLabel[r]} selected={member.role === r} onPress={() => update({ role: r })} />)}
              </Chips>
              <Muted>{roleHelp[member.role]}</Muted>
            </>
          )}
          {isOwner && <Muted>Dono da família: sempre admin.</Muted>}
          <Field label="Parentesco" value={relation} onChangeText={setRelation} maxLength={40} placeholder="Ex.: filho, avó" />
          <Button title="Salvar parentesco" variant="link" onPress={() => update({ relationship: relation.trim() || null })} />
          <Muted>Cor na agenda</Muted>
          <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}>
            {colorPalette.map((c) => (
              <Pressable key={c} onPress={() => update({ color: c })} accessibilityRole="button" accessibilityLabel={`Cor ${c}`}
                accessibilityState={{ selected: memberColor(member, members) === c }}
                style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: c, borderWidth: 3,
                  borderColor: memberColor(member, members) === c ? '#111827' : 'transparent' }} />
            ))}
          </View>
        </>
      )}

      <ErrorText>{error}</ErrorText>
      {!isOwner && (isMe || isAdmin) && (
        <Button title={isMe ? 'Sair da família' : member.user_id ? 'Remover acesso' : 'Remover da família'} variant="link" onPress={remove} />
      )}
    </Screen>
  );
}
