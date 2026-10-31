import { router } from 'expo-router';
import { useState } from 'react';
import { Button, ErrorText, Field, Muted, Screen, Title } from '@/components/ui';
import { setPasswordResetPending } from '@/lib/recovery';
import { errorMessage, supabase } from '@/lib/supabase';

export default function NewPassword() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function save() {
    if (password !== confirm) return setError('As senhas não conferem.');
    setError('');
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) return setError(errorMessage(error));
    setPasswordResetPending(false);
    router.replace('/');
  }

  return (
    <Screen>
      <Title>Crie uma senha nova</Title>
      <Muted>Mínimo de 10 caracteres, com maiúscula, minúscula e número.</Muted>
      <Field label="Nova senha" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password"
        textContentType="newPassword" />
      <Field label="Repita a senha" value={confirm} onChangeText={setConfirm} secureTextEntry autoComplete="new-password"
        textContentType="newPassword" />
      <ErrorText>{error}</ErrorText>
      <Button title="Salvar" onPress={save} loading={loading} />
    </Screen>
  );
}
