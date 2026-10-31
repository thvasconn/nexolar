import { Link, router } from 'expo-router';
import { useState } from 'react';
import { Button, ErrorText, Field, Muted, Screen, Title } from '@/components/ui';
import { errorMessage, supabase } from '@/lib/supabase';

export default function SignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function signIn() {
    setError('');
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setLoading(false);
    if (error?.code === 'email_not_confirmed') {
      await supabase.auth.resend({ type: 'signup', email: email.trim() });
      router.push({ pathname: '/confirmar', params: { email: email.trim(), type: 'signup' } });
    } else if (error) {
      setError(errorMessage(error));
    }
  }

  return (
    <Screen>
      <Title>Entrar</Title>
      <Muted>A organização da sua família em um só lugar.</Muted>
      <Field label="E-mail" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address"
        autoComplete="email" textContentType="emailAddress" />
      <Field label="Senha" value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password"
        textContentType="password" />
      <ErrorText>{error}</ErrorText>
      <Button title="Entrar" onPress={signIn} loading={loading} />
      <Link href="/esqueci" asChild><Button title="Esqueci minha senha" variant="link" onPress={() => {}} /></Link>
      <Link href="/cadastro" asChild><Button title="Criar conta" variant="link" onPress={() => {}} /></Link>
    </Screen>
  );
}
