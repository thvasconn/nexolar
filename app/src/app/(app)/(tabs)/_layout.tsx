import { Redirect, Tabs } from 'expo-router';
import { Text } from 'react-native';
import { Bell } from '@/components/bell';
import { colors } from '@/components/ui';
import { useFamily } from '@/lib/family';

// ponytail: emoji no lugar de ícones até o JV definir a identidade visual
const icon = (emoji: string) => ({ tabBarIcon: () => <Text style={{ fontSize: 18 }}>{emoji}</Text> });

export default function TabsLayout() {
  const { loading, families } = useFamily();
  if (loading) return null;
  if (families.length === 0) return <Redirect href="/boas-vindas" />;

  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: colors.primary, headerRight: () => <Bell /> }}>
      <Tabs.Screen name="index" options={{ title: 'Eu', ...icon('🙂') }} />
      <Tabs.Screen name="familia-home" options={{ title: 'Família', ...icon('🏠') }} />
      <Tabs.Screen name="agenda" options={{ title: 'Agenda', ...icon('📅') }} />
      <Tabs.Screen name="compras" options={{ title: 'Compras', ...icon('🛒') }} />
      <Tabs.Screen name="mais" options={{ title: 'Mais', ...icon('☰') }} />
    </Tabs>
  );
}
