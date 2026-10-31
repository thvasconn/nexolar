import { router } from 'expo-router';
import { useState } from 'react';
import { Button, ErrorText, Field, Muted, Screen } from '@/components/ui';
import { useFamily } from '@/lib/family';
import { errorMessage, supabase } from '@/lib/supabase';

export default function NewFamily() {
  const { selectFamily } = useFamily();
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function create() {
    if (!name.trim()) return setError('Dê um nome para a família.');
    setError('');
    setLoading(true);
    const { data, error } = await supabase.rpc('create_family', { p_name: name.trim() });
    setLoading(false);
    if (error) return setError(errorMessage(error));
    selectFamily(data as string);
    router.dismissTo('/');
  }

  return (
    <Screen>
      <Muted>Ex.: "Casa da Ana", "Família Silva".</Muted>
      <Field label="Nome da família" value={name} onChangeText={setName} maxLength={60} />
      <ErrorText>{error}</ErrorText>
      <Button title="Criar" onPress={create} loading={loading} />
    </Screen>
  );
}
