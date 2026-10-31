import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import { Button, Card, Chip, Chips, Empty, ErrorText, Field, Muted, Screen, Section } from '@/components/ui';
import { type Bill, type BillPayment, currentPeriod, dueLabel, dueThisMonth, isPaid } from '@/lib/bills';
import { memberName, useFamily } from '@/lib/family';
import { fmtMoney, parseMoney } from '@/lib/format';
import { errorMessage, supabase } from '@/lib/supabase';

const categories = ['Energia', 'Água', 'Gás', 'Internet', 'Telefone', 'Streaming', 'Aluguel', 'Escola', 'Outros'];

export default function Bills() {
  const { family, members } = useFamily();
  const [bills, setBills] = useState<Bill[]>([]);
  const [payments, setPayments] = useState<BillPayment[]>([]);
  const [name, setName] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [dueDay, setDueDay] = useState('');
  const [responsible, setResponsible] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    if (!family) return;
    supabase.from('bills').select('id, name, category, amount_cents, due_day, responsible_id, active')
      .eq('family_id', family.id).eq('active', true).order('due_day')
      .then(({ data }) => setBills(data ?? []));
    supabase.from('bill_payments').select('bill_id, period').eq('period', currentPeriod())
      .then(({ data }) => setPayments(data ?? []));
  }, [family]);
  useFocusEffect(load);

  if (!family) return null;

  async function add() {
    const day = Number(dueDay);
    const cents = amount.trim() ? parseMoney(amount) : null;
    if (!name.trim()) return setError('Dê um nome à conta.');
    if (!(day >= 1 && day <= 31)) return setError('Dia de vencimento entre 1 e 31.');
    if (amount.trim() && !cents) return setError('Valor inválido. Ex.: 129,90');
    setError('');
    const { error } = await supabase.from('bills').insert({
      family_id: family!.id, name: name.trim(), category, amount_cents: cents, due_day: day, responsible_id: responsible,
    });
    if (error) return setError(errorMessage(error));
    setName(''); setAmount(''); setDueDay(''); setCategory(null); setResponsible(null);
    load();
  }

  async function togglePaid(b: Bill) {
    const { error } = isPaid(b, payments)
      ? await supabase.from('bill_payments').delete().eq('bill_id', b.id).eq('period', currentPeriod())
      : await supabase.from('bill_payments').insert({ bill_id: b.id, period: currentPeriod(), amount_cents: b.amount_cents });
    if (error) setError(errorMessage(error));
    load();
  }

  function remove(b: Bill) {
    Alert.alert('Parar de acompanhar esta conta?', b.name, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Remover', style: 'destructive', onPress: async () => {
        await supabase.from('bills').update({ active: false }).eq('id', b.id); load();
      } },
    ]);
  }

  const sorted = [...bills].sort((a, b) => dueThisMonth(a).getTime() - dueThisMonth(b).getTime());
  const open = sorted.filter((b) => !isPaid(b, payments));
  const paid = sorted.filter((b) => isPaid(b, payments));
  const total = (list: Bill[]) => list.reduce((s, b) => s + (b.amount_cents ?? 0), 0);
  const card = (b: Bill) => (
    <Card key={b.id} title={`${isPaid(b, payments) ? '✅ ' : ''}${b.name}${b.amount_cents ? ` · ${fmtMoney(b.amount_cents)}` : ''}`}
      subtitle={[isPaid(b, payments) ? 'paga este mês' : dueLabel(b), b.category,
        b.responsible_id && memberName(members.find((m) => m.id === b.responsible_id)!)].filter(Boolean).join(' · ')}
      onPress={() => togglePaid(b)}
      right={<Button title="✕" variant="link" onPress={() => remove(b)} />} />
  );

  return (
    <Screen>
      <Muted>Toque numa conta para marcar como paga (ou desfazer).</Muted>
      <Section>A pagar este mês {total(open) ? `· ${fmtMoney(total(open))}` : ''}</Section>
      {open.length === 0 && <Empty>Tudo pago! 🎉</Empty>}
      {open.map(card)}
      {paid.length > 0 && <Section>Pagas {total(paid) ? `· ${fmtMoney(total(paid))}` : ''}</Section>}
      {paid.map(card)}

      <Section>Nova conta</Section>
      <Chips>{categories.map((c) => <Chip key={c} label={c} selected={category === c} onPress={() => { setCategory(c); if (!name) setName(c); }} />)}</Chips>
      <Field label="Nome" value={name} onChangeText={setName} placeholder="Ex.: Conta de luz" maxLength={60} />
      <Field label="Valor estimado (opcional)" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0,00" />
      <Field label="Dia do vencimento" value={dueDay} onChangeText={(v) => setDueDay(v.replace(/\D/g, ''))} keyboardType="number-pad" maxLength={2} />
      <Muted>Quem paga (recebe o aviso 2 dias antes)</Muted>
      <Chips>
        <Chip label="Todos os adultos" selected={!responsible} onPress={() => setResponsible(null)} />
        {members.filter((m) => m.kind === 'person' && m.user_id).map((m) => (
          <Chip key={m.id} label={memberName(m)} selected={responsible === m.id} onPress={() => setResponsible(m.id)} />
        ))}
      </Chips>
      <ErrorText>{error}</ErrorText>
      <Button title="Adicionar conta" onPress={add} />
    </Screen>
  );
}
