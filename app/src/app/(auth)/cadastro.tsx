import { router } from 'expo-router';
import { useState } from 'react';
import { Button, ErrorText, Field, Muted, Screen, Title } from '@/components/ui';
import { errorMessage, supabase } from '@/lib/supabase';

export default function SignUp() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function signUp() {
    if (!name.trim()) return setError('Informe seu nome.');
    setError('');
    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { full_name: name.trim() } },
    });
    setLoading(false);
    if (error) return setError(errorMessage(error));
    router.push({ pathname: '/confirmar', params: { email: email.trim(), type: 'signup' } });
  }

  return (
    <Screen>
      <Title>Criar conta</Title>
      <Muted>Grátis. Você cria sua família logo em seguida.</Muted>
      <Field label="Nome" value={name} onChangeText={setName} autoComplete="name" textContentType="name" maxLength={100} />
      <Field label="E-mail" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address"
        autoComplete="email" textContentType="emailAddress" />
      <Field label="Senha" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password"
        textContentType="newPassword" />
      <Muted>Mínimo de 10 caracteres, com maiúscula, minúscula e número.</Muted>
      <ErrorText>{error}</ErrorText>
      <Button title="Criar conta" onPress={signUp} loading={loading} />
      <Button title="Já tenho conta" variant="link" onPress={() => router.back()} />
    </Screen>
  );
}
