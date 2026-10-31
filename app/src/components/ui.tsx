import type { ReactNode } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
  type TextInputProps,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

// ponytail: estilos mínimos até o design system do JV chegar
export const colors = { primary: '#1d4ed8', text: '#111827', muted: '#6b7280', border: '#d1d5db', error: '#b91c1c', bg: '#ffffff' };

export function Screen({ children }: { children: ReactNode }) {
  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
      <KeyboardAvoidingView style={styles.safe} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">{children}</ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export const Title = ({ children }: { children: ReactNode }) => <Text style={styles.title} accessibilityRole="header">{children}</Text>;
export const Muted = ({ children }: { children: ReactNode }) => <Text style={styles.muted}>{children}</Text>;
export const ErrorText = ({ children }: { children: ReactNode }) =>
  children ? <Text style={styles.error} accessibilityLiveRegion="polite">{children}</Text> : null;

export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <>
      <Text style={styles.label}>{label}</Text>
      <TextInput accessibilityLabel={label} placeholderTextColor={colors.muted} {...props} style={[styles.input, props.style]} />
    </>
  );
}

export function Button({ title, onPress, loading, variant = 'primary' }:
  { title: string; onPress: () => void; loading?: boolean; variant?: 'primary' | 'link' }) {
  const link = variant === 'link';
  return (
    <Pressable
      onPress={onPress}
      disabled={loading}
      accessibilityRole="button"
      style={({ pressed }) => [link ? styles.link : styles.button, pressed && { opacity: 0.7 }]}
    >
      {loading ? <ActivityIndicator color="#fff" /> : <Text style={link ? styles.linkText : styles.buttonText}>{title}</Text>}
    </Pressable>
  );
}

export function Chip({ label, selected, onPress }: { label: string; selected?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected }}
      style={[styles.chip, selected && styles.chipOn]}>
      <Text style={[styles.chipText, selected && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

export const Chips = ({ children }: { children: ReactNode }) => <View style={styles.chips}>{children}</View>;

export function Card({ title, subtitle, right, onPress }:
  { title: string; subtitle?: string | null; right?: ReactNode; onPress?: () => void }) {
  const body = (
    <View style={styles.card}>
      <View style={{ flex: 1 }}>
        <Text style={styles.cardTitle}>{title}</Text>
        {subtitle ? <Text style={styles.muted}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
  return onPress ? <Pressable onPress={onPress} accessibilityRole="button">{body}</Pressable> : body;
}

export const Section = ({ children }: { children: ReactNode }) => <Text style={styles.section}>{children}</Text>;
export const Empty = ({ children }: { children: ReactNode }) => <Text style={styles.empty}>{children}</Text>;

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 4 },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: 20, paddingVertical: 6, paddingHorizontal: 12 },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.text },
  chipTextOn: { color: '#fff', fontWeight: '600' },
  card: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 14, gap: 8 },
  cardTitle: { fontSize: 16, fontWeight: '600', color: colors.text },
  section: { fontSize: 18, fontWeight: '700', color: colors.text, marginTop: 16 },
  empty: { color: colors.muted, fontStyle: 'italic', paddingVertical: 8 },
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 24, gap: 8 },
  title: { fontSize: 26, fontWeight: '700', color: colors.text, marginBottom: 8 },
  muted: { color: colors.muted, fontSize: 15 },
  label: { color: colors.text, fontWeight: '600', marginTop: 8 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 12, fontSize: 16, color: colors.text },
  error: { color: colors.error, marginTop: 4 },
  button: { backgroundColor: colors.primary, borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 12 },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  link: { padding: 10, alignItems: 'center' },
  linkText: { color: colors.primary, fontWeight: '600' },
});
