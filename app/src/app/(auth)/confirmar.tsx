import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Button, ErrorText, Field, Muted, Screen, Title } from '@/components/ui';
import { setPasswordResetPending } from '@/lib/recovery';
import { errorMessage, supabase } from '@/lib/supabase';

// Código de 6 dígitos do e-mail, para cadastro e para recuperar senha.
// Ao validar, o usuário fica logado e o layout raiz leva para o app.
export default function ConfirmCode() {
  const { email, type } = useLocalSearchParams<{ email: string; type: 'signup' | 'recovery' }>();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);

  async function verify() {
    setError('');
    setLoading(true);
    if (type === 'recovery') setPasswordResetPending(true);
    const { error } = await supabase.auth.verifyOtp({ email, token: code.trim(), type });
    setLoading(false);
    if (error) {
      setPasswordResetPending(false);
      setError(errorMessage(error));
    }
  }

  async function resend() {
    setError('');
    const { error } = type === 'recovery'
      ? await supabase.auth.resetPasswordForEmail(email)
      : await supabase.auth.resend({ type: 'signup', email });
    if (error) setError(errorMessage(error));
    else setInfo('Enviamos um novo código.');
  }

  return (
    <Screen>
      <Title>Digite o código</Title>
      <Muted>Enviamos um código de 6 dígitos para {email}.</Muted>
      <Field label="Código" value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={6}
        autoComplete="one-time-code" textContentType="oneTimeCode" />
      <ErrorText>{error}</ErrorText>
      {info ? <Muted>{info}</Muted> : null}
      <Button title="Confirmar" onPress={verify} loading={loading} />
      <Button title="Reenviar código" variant="link" onPress={resend} />
    </Screen>
  );
}
