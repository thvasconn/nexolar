import { Stack } from 'expo-router';

export const unstable_settings = { initialRouteName: 'entrar' };

export default function AuthLayout() {
  return <Stack screenOptions={{ title: '', headerShadowVisible: false, headerBackTitle: 'Voltar' }} />;
}
