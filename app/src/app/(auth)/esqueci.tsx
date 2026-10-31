import { router } from 'expo-router';
import { useState } from 'react';
import { Button, ErrorText, Field, Muted, Screen, Title } from '@/components/ui';
import { errorMessage, supabase } from '@/lib/supabase';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function send() {
    setError('');
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim());
    setLoading(false);
    // Não revela se o e-mail existe: segue para o código de qualquer jeito, exceto em limite de tentativas.
    if (error && error.status === 429) return setError(errorMessage(error));
    router.push({ pathname: '/confirmar', params: { email: email.trim(), type: 'recovery' } });
  }

  return (
    <Screen>
      <Title>Esqueci minha senha</Title>
      <Muted>Vamos mandar um código para o seu e-mail.</Muted>
      <Field label="E-mail" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address"
        autoComplete="email" textContentType="emailAddress" />
      <ErrorText>{error}</ErrorText>
      <Button title="Enviar código" onPress={send} loading={loading} />
      <Button title="Voltar" variant="link" onPress={() => router.back()} />
    </Screen>
  );
}
